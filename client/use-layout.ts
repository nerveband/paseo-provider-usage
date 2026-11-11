import { useSettings } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultPreferences,
  preferencesFromState,
  samePreferences,
  sanitizePreferences,
  type LayoutPreferences,
} from "../shared/layout";
import { layoutSettings } from "../shared/usage";

/** Quiet period before a change is written, so a burst of moves is one save. */
const SAVE_DELAY_MS = 500;
/** How long the screen waits for the stored layout before it shows the default one. */
const LOAD_WAIT_MS = 1500;

/**
 * The owner's layout, kept by the host's plugin settings store and pushed to every client of
 * this host. Changes apply at once and are saved after a short pause; if a save fails, the
 * screen keeps working from local state and `saveFailed` says so. There is no polling: the host
 * loads the settings once and pushes later changes.
 */
export function useLayoutPreferences() {
  const settings = useSettings(layoutSettings);
  const [prefs, setPrefs] = useState<LayoutPreferences>(defaultPreferences);
  const [saveFailed, setSaveFailed] = useState(false);
  const [waited, setWaited] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Local edits made, and the edit the store has confirmed. Equal means nothing is unsaved. */
  const edits = useRef(0);
  const saved = useRef(0);
  const inFlight = useRef(false);
  const failed = useRef<{ edit: number; revision: string | null } | null>(null);

  const status = settings.status;
  const revision = status === "ready" || status === "invalid" ? settings.revision : null;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), LOAD_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Adopt what the store holds (first load, or a change from another device) unless this
  // client has an edit the store has not confirmed yet.
  useEffect(() => {
    if (status === "loading" || edits.current !== saved.current) return;
    const next = preferencesFromState(settings);
    setPrefs((current) => (samePreferences(current, next) ? current : next));
  }, [status, revision]);

  // Save after a pause. One write at a time; a failed write is not retried until there is a new
  // edit or the stored revision moves (another device saved), so it can never loop.
  useEffect(() => {
    if (edits.current === saved.current || inFlight.current || status === "loading") return;
    if (status === "error") {
      setSaveFailed(true);
      return;
    }
    if (failed.current && failed.current.edit === edits.current && failed.current.revision === revision) return;
    const timer = setTimeout(() => {
      const current = settingsRef.current;
      if (current.status !== "ready" && current.status !== "invalid") return;
      const edit = edits.current;
      // A corrupt or unreadable file cannot be saved over; reset it to the defaults first, and
      // the next pass writes the layout against the new revision.
      const resetting = current.status === "invalid";
      inFlight.current = true;
      const write = resetting ? current.reset() : current.save(prefsRef.current, current.revision);
      void write.then((ok) => {
        inFlight.current = false;
        if (ok && !resetting) saved.current = edit;
        failed.current = ok ? null : { edit, revision: current.revision };
        setSaveFailed(!ok);
        setAttempts((count) => count + 1);
      });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [prefs, status, revision, attempts]);

  // Leaving the screen inside the pause still saves the last change.
  useEffect(
    () => () => {
      const current = settingsRef.current;
      if (edits.current !== saved.current && !inFlight.current && current.status === "ready") {
        void current.save(prefsRef.current, current.revision);
      }
    },
    [],
  );

  const update = useCallback((change: (current: LayoutPreferences) => LayoutPreferences) => {
    edits.current += 1;
    setPrefs((current) => sanitizePreferences(change(current)));
  }, []);

  return {
    prefs,
    update,
    /** The stored layout has loaded (or failed to, or took too long), so it is safe to draw. */
    ready: status !== "loading" || waited,
    saveFailed,
  };
}
