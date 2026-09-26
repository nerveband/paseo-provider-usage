import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  usageSnapshotSchema,
  type ProviderUsage,
  type TokenAnalyticsFilter,
  type TokenAnalyticsResponse,
  type TokenTimeBucket,
} from "../shared/usage";

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

const codexBarInstallHint =
  "CodexBar CLI not found. Install it from https://github.com/steipete/CodexBar/releases " +
  "(CodexBarCLI tarball) into ~/.local/bin or another PATH directory, or set CODEXBAR_BIN.";

/** Finds the CodexBar CLI: CODEXBAR_BIN, then PATH, then common install directories. */
async function findCodexBar(): Promise<string | null> {
  const override = process.env.CODEXBAR_BIN;
  if (override) return override;
  const directories = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/Applications/CodexBar.app/Contents/Helpers",
  ];
  for (const directory of directories) {
    const candidate = join(directory, "codexbar");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next directory.
    }
  }
  return null;
}

async function runCodexBar(
  providerId: ProviderId,
  forceRefresh: boolean,
): Promise<ProviderUsage> {
  let temporaryDirectory: string | null = null;
  try {
    const binary = await findCodexBar();
    if (!binary) throw new Error(codexBarInstallHint);
    const auth = await resolveAuth(providerId, forceRefresh);
    temporaryDirectory = auth.directory;
    const args = ["usage", "--provider", providerId, "--format", "json", "--source", auth.source];
    const { stdout } = await execFileAsync(
      binary,
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
      error:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? codexBarInstallHint
          : error.message || "Usage unavailable",
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

export async function handleProviderUsage({ force }: { force?: boolean } = {}) {
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

/* ========================================================================== */
/* Historical Token Usage & Model Analytics                                   */
/* ========================================================================== */

interface PriceRecord {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const MODEL_PRICES: Record<string, PriceRecord> = {
  "claude-3-7-sonnet": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-3-5-haiku": { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
  "claude-opus-5": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-3-opus": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-fable-5-1": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "gpt-5.4": { input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 2.5 },
  "gpt-5.6-luna": { input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 2.5 },
  "gpt-5.6-sol": { input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 2.5 },
  "gpt-6-astra": { input: 5.0, output: 20.0, cacheRead: 2.5, cacheWrite: 5.0 },
  "o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 1.1 },
  "gemini-3.7-flash": { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
  "gemini-3.8-flash": { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
  "gemini-2.5-pro": { input: 1.25, output: 5.0, cacheRead: 0.3125, cacheWrite: 1.25 },
};

function calculateTurnCost(
  modelId: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  embeddedCost: number | null,
): number | null {
  if (embeddedCost !== null && embeddedCost > 0) {
    return Number(embeddedCost.toFixed(6));
  }
  const cleanModel = modelId.toLowerCase().replace(/^[^/]+\//, "");
  let price: PriceRecord | undefined = MODEL_PRICES[cleanModel];
  if (!price) {
    const key = Object.keys(MODEL_PRICES).find((k) => cleanModel.includes(k) || k.includes(cleanModel));
    if (key) price = MODEL_PRICES[key];
  }
  if (!price) return null;
  const cost =
    (input * price.input +
      output * price.output +
      cacheRead * price.cacheRead +
      cacheWrite * price.cacheWrite) /
    1_000_000;
  return Number(cost.toFixed(6));
}
function getModelPricingBasis(modelId: string): string {
  const cleanModel = modelId.toLowerCase().replace(/^[^/]+\//, "");
  let price = MODEL_PRICES[cleanModel];
  if (!price) {
    const key = Object.keys(MODEL_PRICES).find((k) => cleanModel.includes(k) || k.includes(cleanModel));
    if (key) price = MODEL_PRICES[key];
  }
  if (price) {
    return `Standard API rate ($${price.input}/$${price.output} per 1M)`;
  }
  return "Embedded session telemetry";
}


function formatProviderLabel(providerId: string): string {
  const map: Record<string, string> = {
    claude: "Claude Code",
    codex: "Codex",
    omp: "OMP",
    "google-antigravity": "Antigravity",
    antigravity: "Antigravity",
    opencode: "OpenCode",
    pi: "Pi",
  };
  return map[providerId.toLowerCase()] ?? providerId;
}

function formatModelLabel(modelId: string): string {
  const clean = modelId.replace(/^[^/]+\//, "");
  return clean
    .split(/[-_]/)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

interface NormalizedTurn {
  id: string;
  sessionId: string;
  timestamp: number;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

interface SessionCacheEntry {
  mtimeMs: number;
  size: number;
  turns: NormalizedTurn[];
}

const analyticsCachePath = join(
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
  "paseo-provider-usage",
  "analytics-index.json",
);

const sessionFileCache = new Map<string, SessionCacheEntry>();
let analyticsRestored = false;

async function restoreAnalyticsCache(): Promise<void> {
  if (analyticsRestored) return;
  analyticsRestored = true;
  try {
    const raw = await readFile(analyticsCachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const [key, val] of Object.entries(parsed)) {
        const entry = val as SessionCacheEntry;
        if (entry && typeof entry.mtimeMs === "number" && Array.isArray(entry.turns)) {
          sessionFileCache.set(key, entry);
        }
      }
    }
  } catch {}
}

async function persistAnalyticsCache(): Promise<void> {
  try {
    await mkdir(dirname(analyticsCachePath), { recursive: true, mode: 0o700 });
    const obj = Object.fromEntries(sessionFileCache.entries());
    const temporary = `${analyticsCachePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(obj), { mode: 0o600 });
    await rename(temporary, analyticsCachePath);
  } catch {}
}

async function parseSessionFile(
  filePath: string,
  defaultModel: string,
  defaultProvider: string,
  sessionId: string,
): Promise<NormalizedTurn[]> {
  try {
    const fileStat = await stat(filePath);
    const cachedEntry = sessionFileCache.get(filePath);
    if (cachedEntry && cachedEntry.mtimeMs === fileStat.mtimeMs && cachedEntry.size === fileStat.size) {
      return cachedEntry.turns;
    }

    const raw = await readFile(filePath, "utf8");
    const lines = raw.split("\n");
    const turns: NormalizedTurn[] = [];
    let currentModel = defaultModel;
    let currentProvider = defaultProvider;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.includes('"type":"model_change"')) {
        try {
          const parsed = JSON.parse(line);
          if (typeof parsed?.model === "string" && parsed.model) {
            currentModel = parsed.model;
          }
        } catch {}
        continue;
      }

      if (line.includes('"usage"')) {
        try {
          const parsed = JSON.parse(line);
          const msg = parsed?.message;
          const usage = msg?.usage ?? parsed?.usage;
          if (usage && typeof usage === "object") {
            const input = Number(usage.input ?? usage.inputTokens ?? usage.prompt_tokens) || 0;
            const output = Number(usage.output ?? usage.outputTokens ?? usage.completion_tokens) || 0;
            const cacheRead = Number(usage.cacheRead ?? usage.cache_read ?? usage.cachedInputTokens) || 0;
            const cacheWrite = Number(usage.cacheWrite ?? usage.cache_write) || 0;
            const total = Number(usage.totalTokens ?? usage.total_tokens) || input + output + cacheRead + cacheWrite;

            if (total > 0) {
              let embeddedCost: number | null = null;
              if (usage.cost && typeof usage.cost === "object") {
                embeddedCost = Number(usage.cost.total) || null;
              }

              const modelId = String(msg?.model ?? parsed?.model ?? currentModel ?? "unknown");
              const providerId = String(msg?.provider ?? parsed?.provider ?? currentProvider ?? "omp");
              const ts = parsed.timestamp
                ? typeof parsed.timestamp === "number"
                  ? parsed.timestamp
                  : Date.parse(parsed.timestamp)
                : Date.now();

              const costUsd = calculateTurnCost(modelId, input, output, cacheRead, cacheWrite, embeddedCost);

              turns.push({
                id: parsed.id ? String(parsed.id) : `${sessionId}_turn_${i}`,
                sessionId,
                timestamp: Number.isNaN(ts) ? Date.now() : ts,
                providerId,
                providerLabel: formatProviderLabel(providerId),
                modelId,
                modelLabel: formatModelLabel(modelId),
                inputTokens: input,
                outputTokens: output,
                cacheReadTokens: cacheRead,
                cacheWriteTokens: cacheWrite,
                totalTokens: total,
                costUsd,
              });
            }
          }
        } catch {}
      }
    }

    sessionFileCache.set(filePath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      turns,
    });
    return turns;
  } catch {
    return [];
  }
}

async function discoverAllTurns(): Promise<{
  turns: NormalizedTurn[];
  agentsDiscovered: number;
  sessionsParsed: number;
}> {
  const allTurns: NormalizedTurn[] = [];
  let agentsDiscovered = 0;
  let sessionsParsed = 0;
  await restoreAnalyticsCache();
  const agentsRoot = join(homedir(), ".paseo", "agents");

  try {
    const subdirs = await readdir(agentsRoot, { withFileTypes: true });
    for (const dir of subdirs) {
      if (!dir.isDirectory()) continue;
      const workspaceDir = join(agentsRoot, dir.name);
      try {
        const files = await readdir(workspaceDir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          agentsDiscovered++;
          const agentPath = join(workspaceDir, file);
          try {
            const rawAgent = await readFile(agentPath, "utf8");
            const agent = JSON.parse(rawAgent);
            const agentId = String(agent.id || file.replace(/\.json$/, ""));
            const defaultModel = String(agent.config?.model || agent.runtimeInfo?.model || "default");
            const defaultProvider = String(agent.provider || "omp");
            const handle = agent.persistence?.nativeHandle;

            let turns: NormalizedTurn[] = [];
            if (handle && typeof handle === "string") {
              turns = await parseSessionFile(handle, defaultModel, defaultProvider, agentId);
              if (turns.length > 0) sessionsParsed++;
            }

            if (turns.length === 0 && agent.lastUsage) {
              const u = agent.lastUsage;
              const input = Number(u.inputTokens) || 0;
              const output = Number(u.outputTokens) || 0;
              const cacheRead = Number(u.cachedInputTokens) || 0;
              const total = input + output + cacheRead;
              if (total > 0) {
                const ts = Date.parse(agent.updatedAt || agent.createdAt || "") || Date.now();
                const costUsd = typeof u.totalCostUsd === "number" ? u.totalCostUsd : calculateTurnCost(defaultModel, input, output, cacheRead, 0, null);
                turns.push({
                  id: `${agentId}_lastUsage`,
                  sessionId: agentId,
                  timestamp: ts,
                  providerId: defaultProvider,
                  providerLabel: formatProviderLabel(defaultProvider),
                  modelId: defaultModel,
                  modelLabel: formatModelLabel(defaultModel),
                  inputTokens: input,
                  outputTokens: output,
                  cacheReadTokens: cacheRead,
                  cacheWriteTokens: 0,
                  totalTokens: total,
                  costUsd,
                });
              }
            }

            for (const t of turns) {
              allTurns.push(t);
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}

  void persistAnalyticsCache();
  return { turns: allTurns, agentsDiscovered, sessionsParsed };
}

export async function handleTokenAnalytics(
  filter: TokenAnalyticsFilter,
): Promise<TokenAnalyticsResponse> {
  const { turns: allDiscoveredTurns, agentsDiscovered, sessionsParsed } = await discoverAllTurns();

  const availableProvidersMap = new Map<string, string>();
  const availableModelsMap = new Map<string, { label: string; providerId: string }>();

  for (const t of allDiscoveredTurns) {
    availableProvidersMap.set(t.providerId, t.providerLabel);
    availableModelsMap.set(t.modelId, { label: t.modelLabel, providerId: t.providerId });
  }

  const availableProviders = Array.from(availableProvidersMap.entries()).map(([id, label]) => ({
    id,
    label,
  }));
  const availableModels = Array.from(availableModelsMap.entries()).map(([id, info]) => ({
    id,
    label: info.label,
    providerId: info.providerId,
  }));

  let timeZone = filter.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    timeZone = "UTC";
  }
  const range = filter.range ?? "7d";
  const now = Date.now();
  let startTime = now - 7 * 86400 * 1000;
  let bucketGranularity: "hour" | "day" = "day";
  let bucketCount = 7;

  if (range === "24h") {
    startTime = now - 24 * 3600 * 1000;
    bucketGranularity = "hour";
    bucketCount = 24;
  } else if (range === "7d") {
    startTime = now - 7 * 86400 * 1000;
    bucketGranularity = "day";
    bucketCount = 7;
  } else if (range === "14d") {
    startTime = now - 14 * 86400 * 1000;
    bucketGranularity = "day";
    bucketCount = 14;
  } else if (range === "30d") {
    startTime = now - 30 * 86400 * 1000;
    bucketGranularity = "day";
    bucketCount = 30;
  } else if (range === "all") {
    bucketGranularity = "day";
    const minTs = allDiscoveredTurns.reduce((min, t) => Math.min(min, t.timestamp), now);
    const daysDiff = Math.max(7, Math.ceil((now - minTs) / (86400 * 1000)));
    bucketCount = daysDiff;
    startTime = now - bucketCount * 86400 * 1000;
  }

  // Initialize empty timeline buckets so the heatmap grid has no missing days/hours
  const buckets: TokenTimeBucket[] = [];
  const stepMs = bucketGranularity === "hour" ? 3600 * 1000 : 86400 * 1000;
  const alignedStart = Math.floor(startTime / stepMs) * stepMs;

  for (let i = 0; i < bucketCount; i++) {
    const slotTs = alignedStart + i * stepMs;
    const d = new Date(slotTs);
    const label =
      bucketGranularity === "hour"
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false, timeZone })
        : d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric", timeZone });

    buckets.push({
      timestamp: new Date(slotTs).toISOString(),
      label,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: null,
      turnCount: 0,
      sessionCount: 0,
      intensity: 0,
      modelBreakdown: [],
    });
  }

  // Filter matching turns
  const matchingTurns: NormalizedTurn[] = [];
  let unpricedTokens = 0;

  for (const t of allDiscoveredTurns) {
    if (t.timestamp < alignedStart || t.timestamp > now + stepMs) continue;
    if (filter.providerId && t.providerId.toLowerCase() !== filter.providerId.toLowerCase()) continue;
    if (filter.modelId && t.modelId.toLowerCase() !== filter.modelId.toLowerCase()) continue;

    matchingTurns.push(t);
    if (t.costUsd === null) {
      unpricedTokens += t.totalTokens;
    }

    const bucketIdx = Math.floor((t.timestamp - alignedStart) / stepMs);
    if (bucketIdx >= 0 && bucketIdx < buckets.length) {
      const b = buckets[bucketIdx];
      b.totalTokens += t.totalTokens;
      b.inputTokens += t.inputTokens;
      b.outputTokens += t.outputTokens;
      b.cacheReadTokens += t.cacheReadTokens;
      b.cacheWriteTokens += t.cacheWriteTokens;
      b.turnCount += 1;

      if (t.costUsd !== null) {
        b.estimatedCostUsd = Number(((b.estimatedCostUsd ?? 0) + t.costUsd).toFixed(4));
      }

      // Model breakdown in bucket
      let mb = b.modelBreakdown.find((m) => m.modelId === t.modelId);
      if (!mb) {
        mb = {
          modelId: t.modelId,
          modelLabel: t.modelLabel,
          providerId: t.providerId,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: null,
        };
        b.modelBreakdown.push(mb);
      }
      mb.totalTokens += t.totalTokens;
      mb.inputTokens += t.inputTokens;
      mb.outputTokens += t.outputTokens;
      mb.cacheReadTokens += t.cacheReadTokens;
      mb.cacheWriteTokens += t.cacheWriteTokens;
      if (t.costUsd !== null) {
        mb.estimatedCostUsd = Number(((mb.estimatedCostUsd ?? 0) + t.costUsd).toFixed(4));
      }
    }
  }

  // Compute session count per bucket
  for (let i = 0; i < buckets.length; i++) {
    const slotTs = alignedStart + i * stepMs;
    const slotEnd = slotTs + stepMs;
    const sessionsInBucket = new Set(
      matchingTurns.filter((t) => t.timestamp >= slotTs && t.timestamp < slotEnd).map((t) => t.sessionId),
    );
    buckets[i].sessionCount = sessionsInBucket.size;
  }

  // Intensity calculation for the heatmap blocks (0 = none, 1-4 = scaled)
  const maxBucketTokens = buckets.reduce((m, b) => Math.max(m, b.totalTokens), 0);
  for (const b of buckets) {
    if (b.totalTokens <= 0 || maxBucketTokens <= 0) {
      b.intensity = 0;
    } else {
      const ratio = b.totalTokens / maxBucketTokens;
      if (ratio <= 0.25) b.intensity = 1;
      else if (ratio <= 0.5) b.intensity = 2;
      else if (ratio <= 0.75) b.intensity = 3;
      else b.intensity = 4;
    }
  }

  // Aggregate overall model summaries
  const modelAggMap = new Map<
    string,
    {
      modelLabel: string;
      providerId: string;
      providerLabel: string;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      estimatedCostUsd: number | null;
    }
  >();

  let grandTotalTokens = 0;
  let grandInputTokens = 0;
  let grandOutputTokens = 0;
  let grandCacheRead = 0;
  let grandCacheWrite = 0;
  let grandCost: number | null = null;
  const allMatchingSessions = new Set<string>();

  for (const t of matchingTurns) {
    grandTotalTokens += t.totalTokens;
    grandInputTokens += t.inputTokens;
    grandOutputTokens += t.outputTokens;
    grandCacheRead += t.cacheReadTokens;
    grandCacheWrite += t.cacheWriteTokens;
    allMatchingSessions.add(t.sessionId);

    if (t.costUsd !== null) {
      grandCost = Number(((grandCost ?? 0) + t.costUsd).toFixed(4));
    }

    let agg = modelAggMap.get(t.modelId);
    if (!agg) {
      agg = {
        modelLabel: t.modelLabel,
        providerId: t.providerId,
        providerLabel: t.providerLabel,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: null,
      };
      modelAggMap.set(t.modelId, agg);
    }
    agg.totalTokens += t.totalTokens;
    agg.inputTokens += t.inputTokens;
    agg.outputTokens += t.outputTokens;
    agg.cacheReadTokens += t.cacheReadTokens;
    agg.cacheWriteTokens += t.cacheWriteTokens;
    if (t.costUsd !== null) {
      agg.estimatedCostUsd = Number(((agg.estimatedCostUsd ?? 0) + t.costUsd).toFixed(4));
    }
  }

  const modelSummaries = Array.from(modelAggMap.entries())
    .map(([modelId, agg]) => ({
      modelId,
      modelLabel: agg.modelLabel,
      providerId: agg.providerId,
      providerLabel: agg.providerLabel,
      totalTokens: agg.totalTokens,
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      cacheReadTokens: agg.cacheReadTokens,
      cacheWriteTokens: agg.cacheWriteTokens,
      estimatedCostUsd: agg.estimatedCostUsd,
      pricingBasis: getModelPricingBasis(modelId),
      percentage: grandTotalTokens > 0 ? Number(((agg.totalTokens / grandTotalTokens) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const topModel = modelSummaries[0] ?? null;
  const daysSpan = Math.max(1, (now - alignedStart) / (86400 * 1000));
  const avgDailyTokens = Math.round(grandTotalTokens / daysSpan);

  const earliestTimestamp = allDiscoveredTurns.length > 0
    ? new Date(allDiscoveredTurns.reduce((min, t) => Math.min(min, t.timestamp), now)).toISOString()
    : null;
  const latestTimestamp = allDiscoveredTurns.length > 0
    ? new Date(allDiscoveredTurns.reduce((max, t) => Math.max(max, t.timestamp), 0)).toISOString()
    : null;

  return {
    generatedAt: new Date().toISOString(),
    timezone: timeZone,
    bucketGranularity,
    summary: {
      totalTokens: grandTotalTokens,
      inputTokens: grandInputTokens,
      outputTokens: grandOutputTokens,
      cacheReadTokens: grandCacheRead,
      cacheWriteTokens: grandCacheWrite,
      estimatedCostUsd: grandCost,
      topModelLabel: topModel ? topModel.modelLabel : null,
      topModelShare: topModel ? topModel.percentage : 0,
      turnCount: matchingTurns.length,
      sessionCount: allMatchingSessions.size,
      avgDailyTokens,
      pricingNote: "Standard direct provider API rates ($/1M tokens) & embedded session telemetry (no OpenRouter markup)",
    },
    buckets,
    models: modelSummaries,
    availableProviders,
    availableModels,
    coverage: {
      earliestTimestamp,
      latestTimestamp,
      agentsDiscovered,
      sessionsParsed,
      unpricedTokens,
    },
  };
}
