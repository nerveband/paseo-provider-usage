import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { usageSnapshotSchema, type ProviderUsage } from "./usage.shared";

const execFileAsync = promisify(execFile);
const providerIds = ["claude", "codex", "antigravity"] as const;
type ProviderId = (typeof providerIds)[number];

type JsonObject = Record<string, unknown>;

const names: Record<ProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
  antigravity: "Antigravity",
};

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addWindow(
  windows: ProviderUsage["windows"],
  id: string,
  label: string,
  candidate: unknown,
): void {
  const value = object(candidate);
  if (!value) return;
  const usedPercent = number(value.usedPercent);
  if (usedPercent === null) return;
  windows.push({
    id,
    label,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: string(value.resetsAt),
    resetDescription: string(value.resetDescription),
    windowMinutes: number(value.windowMinutes),
  });
}

function normalize(providerId: ProviderId, payload: unknown): ProviderUsage {
  const root = object(payload) ?? {};
  const error = object(root.error);
  const usage = object(root.usage);
  const windows: ProviderUsage["windows"] = [];

  if (usage) {
    const labels =
      providerId === "antigravity"
        ? { primary: "Gemini", secondary: "Claude + GPT", tertiary: "Monthly" }
        : { primary: "Session", secondary: "Weekly", tertiary: "Monthly" };
    addWindow(windows, "primary", labels.primary, usage.primary);
    addWindow(windows, "secondary", labels.secondary, usage.secondary);
    addWindow(windows, "tertiary", labels.tertiary, usage.tertiary);

    if (providerId !== "antigravity") {
      const extra = Array.isArray(usage.extraRateWindows) ? usage.extraRateWindows : [];
      for (const item of extra) {
        const entry = object(item);
        if (!entry) continue;
        const title = string(entry.title);
        // Providers also report internal model-pool lanes such as `gpt-reserve`, whose
        // title is an identifier rather than a quota name. Those mirror the main window
        // and are not user-facing limits, so keep them out of the surface.
        if (title && !/\s/.test(title) && /[-_]/.test(title)) continue;
        addWindow(
          windows,
          string(entry.id) ?? `extra-${windows.length}`,
          title ?? "Additional limit",
          entry.window,
        );
      }
    }
  }

  const identity = object(usage?.identity);
  return {
    id: providerId,
    name: names[providerId],
    source: string(root.source),
    account:
      string(usage?.accountEmail) ??
      string(identity?.accountEmail) ??
      string(root.account),
    plan: string(usage?.plan) ?? string(usage?.planLabel) ?? string(identity?.loginMethod),
    updatedAt: string(usage?.updatedAt) ?? string(root.updatedAt),
    windows,
    error: error ? string(error.message) ?? "Usage unavailable" : null,
  };
}

const ompProviders = {
  claude: "anthropic",
  antigravity: "google-antigravity",
} as const;

/**
 * OMP mints a fresh access token on every `--force-refresh`, which invalidates the
 * previously issued one. Read the cached token first so concurrent refreshes cannot
 * revoke each other, and force a refresh only after the provider rejects it.
 */
async function readAccessToken(
  providerId: keyof typeof ompProviders,
  forceRefresh: boolean,
): Promise<string> {
  const args = ["token", ompProviders[providerId]];
  if (forceRefresh) args.push("--force-refresh");
  const { stdout } = await execFileAsync("omp", args, {
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    encoding: "utf8",
  });
  const accessToken = stdout.trim();
  if (!accessToken) throw new Error(`OMP returned no ${names[providerId]} access token`);
  return accessToken;
}

async function createCodexBarEnvironment(
  providerId: keyof typeof ompProviders,
  forceRefresh: boolean,
): Promise<{ env: NodeJS.ProcessEnv; directory: string }> {
  const accessToken = await readAccessToken(providerId, forceRefresh);
  const token =
    providerId === "antigravity"
      ? JSON.stringify({
          access_token: accessToken,
          expiry_date: Date.now() + 30 * 60 * 1000,
        })
      : accessToken;
  const config = {
    version: 1,
    providers: [
      {
        id: providerId,
        enabled: true,
        source: "oauth",
        cookieSource: "auto",
        tokenAccounts: {
          version: 1,
          accounts: [
            {
              id: randomUUID(),
              label: "OMP account",
              token,
              addedAt: Date.now() / 1000,
              lastUsed: null,
            },
          ],
          activeIndex: 0,
        },
      },
    ],
  };
  const directory = await mkdtemp(join(tmpdir(), "paseo-provider-usage-"));
  try {
    const configPath = join(directory, "codexbar.json");
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    return {
      env: { ...process.env, CODEXBAR_CONFIG: configPath },
      directory,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function isAuthenticationFailure(usage: ProviderUsage): boolean {
  if (!usage.error) return false;
  return /unauthor|forbidden|401|403|re-authenticate|expired|invalid_grant|token/i.test(usage.error);
}

type ResolvedAuth = { env: NodeJS.ProcessEnv; directory: string | null; source: string };

/**
 * Codex is read from its own CLI session. Claude and Antigravity are read with an OAuth
 * token borrowed from OMP; when OMP is not installed or cannot mint one, fall back to
 * CodexBar's own provider strategies instead of failing the row.
 */
async function resolveAuth(
  providerId: ProviderId,
  forceRefresh: boolean,
): Promise<ResolvedAuth> {
  const ambient: ResolvedAuth = { env: process.env, directory: null, source: "auto" };
  if (providerId === "codex") return ambient;
  try {
    const { env, directory } = await createCodexBarEnvironment(providerId, forceRefresh);
    return { env, directory, source: "oauth" };
  } catch {
    return ambient;
  }
}

async function runCodexBar(
  providerId: ProviderId,
  forceRefresh: boolean,
): Promise<ProviderUsage> {
  let temporaryDirectory: string | null = null;
  try {
    const auth = await resolveAuth(providerId, forceRefresh);
    temporaryDirectory = auth.directory;
    const args = ["usage", "--provider", providerId, "--format", "json", "--source", auth.source];
    const { stdout } = await execFileAsync(
      process.env.CODEXBAR_BIN || join(homedir(), ".local", "bin", "codexbar"),
      args,
      {
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
        env: auth.env,
      },
    );
    const parsed: unknown = JSON.parse(stdout);
    return normalize(providerId, Array.isArray(parsed) ? parsed[0] : parsed);
  } catch (cause) {
    const error = cause as Error & { stdout?: string };
    if (error.stdout) {
      try {
        const parsed: unknown = JSON.parse(error.stdout);
        return normalize(providerId, Array.isArray(parsed) ? parsed[0] : parsed);
      } catch {
        // Use the process error below when stdout was not valid JSON.
      }
    }
    return {
      id: providerId,
      name: names[providerId],
      source: null,
      account: null,
      plan: null,
      updatedAt: null,
      windows: [],
      error: error.message || "Usage unavailable",
    };
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function fetchProvider(providerId: ProviderId): Promise<ProviderUsage> {
  const usage = await runCodexBar(providerId, false);
  if (providerId === "codex" || !isAuthenticationFailure(usage)) return usage;
  return runCodexBar(providerId, true);
}

type UsageSnapshot = {
  fetchedAt: string;
  providers: ProviderUsage[];
  stale: boolean;
};

/** How long a snapshot is served without triggering a background refresh. */
const SNAPSHOT_TTL_MS = 60_000;

/**
 * Surviving a daemon or plugin reload matters more than a cold-start fetch: the surface
 * should paint the last known numbers immediately and revalidate behind them.
 */
const snapshotPath = join(
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
  "paseo-provider-usage",
  "snapshot.json",
);

/** Shared so overlapping surfaces and refresh presses cannot double-fetch a provider. */
let inFlight: Promise<UsageSnapshot> | null = null;
let cached: { at: number; snapshot: UsageSnapshot } | null = null;
let restored = false;

async function restoreSnapshot(): Promise<void> {
  if (restored) return;
  restored = true;
  try {
    const raw = await readFile(snapshotPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const snapshot = usageSnapshotSchema.parse(parsed);
    // Treat a restored snapshot as stale so the first request revalidates it.
    cached = { at: 0, snapshot: { ...snapshot, stale: true } };
  } catch {
    // No usable snapshot on disk: the first request performs a cold fetch.
  }
}

async function persistSnapshot(snapshot: UsageSnapshot): Promise<void> {
  try {
    await mkdir(dirname(snapshotPath), { recursive: true, mode: 0o700 });
    const temporary = `${snapshotPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temporary, snapshotPath);
  } catch {
    // A cache that cannot be written must not fail the request.
  }
}

function refresh(): Promise<UsageSnapshot> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const snapshot: UsageSnapshot = {
      fetchedAt: new Date().toISOString(),
      providers: await Promise.all(providerIds.map(fetchProvider)),
      stale: false,
    };
    cached = { at: Date.now(), snapshot };
    await persistSnapshot(snapshot);
    return snapshot;
  })();
  return inFlight.finally(() => {
    inFlight = null;
  });
}

export async function handleProviderUsage({ force }: { force?: boolean }) {
  await restoreSnapshot();
  if (force) return refresh();
  if (cached) {
    if (Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.snapshot;
    // Serve what we have now and revalidate behind it, so opening the surface never waits.
    void refresh().catch(() => {});
    return { ...cached.snapshot, stale: true };
  }
  return refresh();
}
