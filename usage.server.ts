import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ProviderUsage } from "./usage.shared";

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
        addWindow(
          windows,
          string(entry.id) ?? `extra-${windows.length}`,
          string(entry.title) ?? "Additional limit",
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

type UsageSnapshot = { fetchedAt: string; providers: ProviderUsage[] };

/**
 * Provider usage endpoints are rate limited per account, so every surface mount must not
 * trigger a fresh upstream fetch. Reuse a recent snapshot and let an explicit refresh
 * bypass it.
 */
const SNAPSHOT_TTL_MS = 60_000;

/** Shared so overlapping surfaces and refresh presses cannot double-fetch a provider. */
let inFlight: Promise<UsageSnapshot> | null = null;
let cached: { at: number; snapshot: UsageSnapshot } | null = null;

export async function handleProviderUsage({ force }: { force?: boolean }) {
  if (!force && cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.snapshot;
  if (inFlight) return inFlight;
  inFlight = (async () => ({
    fetchedAt: new Date().toISOString(),
    providers: await Promise.all(providerIds.map(fetchProvider)),
  }))();
  try {
    const snapshot = await inFlight;
    cached = { at: Date.now(), snapshot };
    return snapshot;
  } finally {
    inFlight = null;
  }
}
