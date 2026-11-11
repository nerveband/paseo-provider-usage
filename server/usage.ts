import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, constants, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { devNull, homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
  usageSnapshotSchema,
  type ProviderUsage,
  type TokenAnalyticsFilter,
  type TokenAnalyticsResponse,
  type TokenTimeBucket,
} from "../shared/usage";

const execFileAsync = promisify(execFile);
const providerIds = ["claude", "codex", "antigravity", "openrouter", "opencodego", "baseten"] as const;
type ProviderId = (typeof providerIds)[number];

type JsonObject = Record<string, unknown>;

const names: Record<ProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
  antigravity: "Antigravity",
  openrouter: "OpenRouter",
  opencodego: "OpenCode Go",
  baseten: "Baseten",
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

type SpendGroup = NonNullable<ProviderUsage["spend"]>["groups"][number];
type SpendRow = SpendGroup["rows"][number];

function emptyUsage(providerId: ProviderId): ProviderUsage {
  return {
    id: providerId,
    name: names[providerId],
    source: null,
    account: null,
    plan: null,
    updatedAt: null,
    windows: [],
    error: null,
    spend: null,
  };
}

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const creditNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatCreditAmount(value: number, currency: string | null): string {
  return `${creditNumber.format(value)}${currency ? ` ${currency}` : ""}`;
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A field the provider's API does not expose gets this row, never a guessed number. The
 * evidence for each case lives beside the provider's code and in the README.
 */
const unavailableValue = "Not available from the API";

function unavailableRow(label: string): SpendRow {
  return { label, value: unavailableValue, unavailable: true };
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Turns CodexBar's credit fields (Codex credits, reset credits, and any provider cost it
 * reports) into label/value groups. Providers without credit fields stay silent here; the
 * ones whose APIs lack a field add their own "not available" rows.
 */
function readProviderSpend(usage: JsonObject | null): ProviderUsage["spend"] {
  const groups: SpendGroup[] = [];
  const notes: string[] = [];

  const cost = object(usage?.providerCost);
  const credits = object(usage?.credits);
  const resetCredits = object(usage?.codexResetCredits);

  if (cost) {
    const currency = string(cost.currencyCode);
    const balance = number(cost.balance);
    const used = number(cost.used);
    const limit = number(cost.limit);
    const period = string(cost.period);
    const title = currency && /credit/i.test(currency) ? currency : period ?? "Balance";
    const rows: SpendRow[] = [];
    if (balance !== null) {
      rows.push({ label: "Remaining", value: formatCreditAmount(balance, currency === title ? null : currency) });
    }
    if (used !== null && used > 0) {
      rows.push({ label: "Used", value: formatCreditAmount(used, currency === title ? null : currency) });
    }
    if (limit !== null && limit > 0) {
      rows.push({ label: "Limit", value: formatCreditAmount(limit, currency === title ? null : currency) });
    }
    if (period && period !== title) rows.push({ label: "Period", value: period });
    if (rows.length > 0) groups.push({ kind: "balance", title, rows });
  } else if (credits) {
    const remaining = number(credits.remaining);
    if (remaining !== null) {
      groups.push({
        kind: "balance",
        title: "Credits",
        rows: [{ label: "Remaining", value: formatCreditAmount(remaining, null) }],
      });
    }
    if (credits.creditsAvailable === false) notes.push("Credits are not available for this account.");
  }

  if (resetCredits) {
    const availableCount = number(resetCredits.availableCount);
    const creditsList = (Array.isArray(resetCredits.credits) ? resetCredits.credits : [])
      .map(object)
      .filter((credit): credit is JsonObject => credit !== null);
    const expiries = creditsList
      .map((credit) => string(credit.expires_at))
      .filter((expiry): expiry is string => expiry !== null)
      .sort();
    const rows: SpendRow[] = [];
    if (availableCount !== null) rows.push({ label: "Available", value: creditNumber.format(availableCount) });
    if (expiries[0]) rows.push({ label: "Next expiry", value: formatExpiry(expiries[0]) });
    if (rows.length > 0) groups.push({ kind: "balance", title: "Rate limit resets", rows });
  }

  if (groups.length === 0 && notes.length === 0) return null;
  return { groups, note: notes.length > 0 ? notes.join(" ") : null };
}

/* ========================================================================== */
/* Baseten                                                                    */
/* ========================================================================== */

const basetenApiBase = "https://api.baseten.co";
const basetenWindowDays = 30;

const basetenSetupHint =
  "Baseten needs an API key: set BASETEN_API_KEY for the Paseo daemon, or sign in to Baseten in " +
  "Pi on this machine. Create a key at https://app.baseten.co/settings/api-keys.";

const basetenKeyHint =
  "Baseten rejected the saved API key. Create a new one at https://app.baseten.co/settings/api-keys " +
  "and update the key the plugin reads.";

/**
 * Reuses a Baseten key that already exists on this machine: the daemon environment first,
 * then the login Pi stores for its own Baseten provider. No new credential store is added.
 */
async function readBasetenKey(): Promise<string | null> {
  const fromEnvironment = string(process.env.BASETEN_API_KEY)?.trim();
  if (fromEnvironment) return fromEnvironment;
  try {
    const raw = await readFile(join(homedir(), ".pi", "agent", "auth.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return string(object(object(parsed)?.baseten)?.key)?.trim() ?? null;
  } catch {
    return null;
  }
}

class HttpStatusError extends Error {
  readonly status: number;
  /** The provider's own error type, such as `EntitlementError`. Never the message or body. */
  readonly errorType: string | null;
  constructor(status: number, errorType: string | null = null) {
    super(`Provider responded with HTTP ${status}`);
    this.status = status;
    this.errorType = errorType;
  }
}

/** Response bodies are never surfaced, so a failed call cannot echo the key. */
async function fetchProviderJson(
  url: string,
  key: string,
  timeoutMs = 20_000,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    throw new HttpStatusError(response.status, string(object(object(detail)?.error)?.type));
  }
  return response.json();
}

type ApiRead =
  | { ok: true; payload: unknown }
  | { ok: false; status: number | null; timedOut: boolean; errorType: string | null };

/** Like fetchProviderJson, but a failure becomes data so independent calls can fail separately. */
async function readApi(
  url: string,
  key: string,
  timeoutMs = 20_000,
  headers: Record<string, string> = {},
): Promise<ApiRead> {
  try {
    return { ok: true, payload: await fetchProviderJson(url, key, timeoutMs, headers) };
  } catch (cause) {
    const http = cause instanceof HttpStatusError ? cause : null;
    return {
      ok: false,
      status: http?.status ?? null,
      timedOut: (cause as Error | undefined)?.name === "TimeoutError",
      errorType: http?.errorType ?? null,
    };
  }
}

function describeFailure(read: Extract<ApiRead, { ok: false }>): string {
  return read.status !== null ? `HTTP ${read.status}` : read.timedOut ? "a timeout" : "a network error";
}

/**
 * Runs `load` unless a result younger than `holdMs` exists. Provider endpoints that are
 * rate limited or ban-prone are asked at most once per hold; the Refresh button passes
 * `force` to bypass it.
 */
const heldResults = new Map<string, { at: number; value: unknown }>();

async function withHold<T>(name: string, holdMs: number, force: boolean, load: () => Promise<T>): Promise<T> {
  const held = heldResults.get(name);
  if (!force && held && Date.now() - held.at < holdMs) return held.value as T;
  const value = await load();
  heldResults.set(name, { at: Date.now(), value });
  return value;
}

function fetchBasetenJson(path: string, key: string, timeoutMs?: number): Promise<unknown> {
  return fetchProviderJson(`${basetenApiBase}${path}`, key, timeoutMs);
}

/** Baseten reports money as decimal strings. A missing value stays missing. */
function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const usdNumber = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Same format as the Intl-formatted Claude amounts, so every dollar figure groups thousands alike. */
function formatUsd(value: number): string {
  return usdNumber.format(value);
}

/** A row's share of its group's total, for a bar drawn from zero. */
function shareOf(part: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, (part / total) * 100)) : 0;
}

const basetenCategories = [
  { key: "model_apis_usage", label: "Model APIs" },
  { key: "dedicated_usage", label: "Dedicated inference" },
  { key: "training_usage", label: "Training" },
  { key: "loops_usage", label: "Loops" },
] as const;

/**
 * Per category, Baseten reports the charge before credits (`subtotal`), the amount the
 * credits covered (`credits_used`), and what is left due (`total`). A fully credit-covered
 * month reads 2.24 / 2.24 / 0.00. The API reports no credit balance, so none is shown.
 */
function readBasetenSpend(summary: JsonObject | null): ProviderUsage["spend"] {
  if (!summary) return null;
  const groups: SpendGroup[] = [];
  const notes: string[] = [];
  const categoryRows: SpendRow[] = [];
  const models: { label: string; amount: number }[] = [];
  let grossTotal = 0;
  let creditTotal = 0;
  let netTotal = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;

  for (const category of basetenCategories) {
    const usage = object(summary[category.key]);
    if (!usage) continue;
    const gross = money(usage.subtotal);
    const credits = money(usage.credits_used);
    const net = money(usage.total);
    if (gross === null && credits === null && net === null) continue;
    grossTotal += gross ?? 0;
    creditTotal += credits ?? 0;
    netTotal += net ?? 0;
    if ((gross ?? 0) > 0) categoryRows.push({ label: category.label, value: formatUsd(gross ?? 0) });

    for (const item of Array.isArray(usage.breakdown) ? usage.breakdown : []) {
      const entry = object(item);
      const name = string(entry?.model_name);
      const amount = money(entry?.subtotal);
      if (name && amount !== null && amount > 0) models.push({ label: name, amount });
      inputTokens += number(entry?.input_tokens) ?? 0;
      outputTokens += number(entry?.output_tokens) ?? 0;
      cachedTokens += number(entry?.cached_input_tokens) ?? 0;
    }
  }

  let headline: NonNullable<ProviderUsage["spend"]>["headline"] = null;
  if (grossTotal > 0 || creditTotal > 0 || netTotal > 0) {
    // The first row is the group's key figure, so the total leads when there are several categories.
    const rows: SpendRow[] =
      categoryRows.length > 1 ? [{ label: "Total before credits", value: formatUsd(grossTotal) }, ...categoryRows] : [...categoryRows];
    if (creditTotal > 0) rows.push({ label: "Credits applied", value: formatUsd(creditTotal) });
    if (grossTotal > 0) rows.push({ label: "Due after credits", value: formatUsd(netTotal) });
    if (rows.length > 0) groups.push({ kind: "spend", title: `Last ${basetenWindowDays} days`, rows });
    if (grossTotal > 0) headline = { label: `Spent, last ${basetenWindowDays} days`, value: formatUsd(grossTotal) };
  }

  if (models.length > 0) {
    models.sort((a, b) => b.amount - a.amount);
    const modelTotal = models.reduce((sum, model) => sum + model.amount, 0);
    const rows: SpendRow[] = models.slice(0, 4).map((model) => ({
      label: model.label,
      value: formatUsd(model.amount),
      share: shareOf(model.amount, modelTotal),
    }));
    const remaining = models.slice(4).reduce((sum, model) => sum + model.amount, 0);
    if (remaining > 0) rows.push({ label: "Other models", value: formatUsd(remaining), share: shareOf(remaining, modelTotal) });
    groups.push({ kind: "breakdown", title: "Model APIs by model", rows });
  }

  if (inputTokens > 0 || outputTokens > 0 || cachedTokens > 0) {
    const rows: SpendRow[] = [];
    if (inputTokens > 0) rows.push({ label: "Input", value: compactNumber.format(inputTokens) });
    if (cachedTokens > 0) rows.push({ label: "Cached input", value: compactNumber.format(cachedTokens) });
    if (outputTokens > 0) rows.push({ label: "Output", value: compactNumber.format(outputTokens) });
    groups.push({ kind: "detail", title: `Tokens, last ${basetenWindowDays} days`, rows });
  }

  if (groups.length === 0) {
    notes.push(`Baseten reported no usage in the last ${basetenWindowDays} days.`);
  }
  // Baseten exposes no credit balance. Evidence, 2026-11-10: the official OpenAPI spec at
  // https://api.baseten.co/v1/spec has no balance field (billing paths are usage_summary,
  // model_apis, and tool_call_usage; /v1/organizations/me returns only org_id, name,
  // created_at, and aws_assume_role), and the billing docs say to check the remaining credit
  // balance on the dashboard: https://docs.baseten.co/organization/billing#credits
  groups.push({
    kind: "balance",
    title: "Credit balance",
    rows: [unavailableRow("Remaining")],
    note: "Baseten exposes the remaining credit balance only on its billing dashboard (app.baseten.co/settings/billing).",
  });
  notes.push("Spend and credits applied come from the Baseten billing API.");
  return { groups, note: notes.join(" "), headline };
}

/** CodexBar has no Baseten provider, so Baseten is read from its own billing API. */
async function fetchBaseten(): Promise<ProviderUsage> {
  // Baseten meters spend and credits; it reports no session or weekly quota window.
  const empty = emptyUsage("baseten");

  const key = await readBasetenKey();
  if (!key) return { ...empty, error: basetenSetupHint };

  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - basetenWindowDays * 86_400_000);
  const query = `start_date=${start.toISOString()}&end_date=${end.toISOString()}`;

  try {
    const [summary, user] = await Promise.all([
      // The billing summary routinely takes 8 to 12 s and longer under load; 20 s timed out.
      fetchBasetenJson(`/v1/billing/usage_summary?${query}`, key, 60_000),
      fetchBasetenJson("/v1/users/me", key).catch(() => null),
    ]);
    return {
      ...empty,
      source: "api",
      account: string(object(user)?.email),
      updatedAt: new Date().toISOString(),
      spend: readBasetenSpend(object(summary)),
    };
  } catch (cause) {
    const status = cause instanceof HttpStatusError ? cause.status : null;
    const timedOut = (cause as Error | undefined)?.name === "TimeoutError";
    return {
      ...empty,
      source: "api",
      error:
        status === 401 || status === 403
          ? basetenKeyHint
          : status !== null
            ? `Baseten usage could not be loaded (HTTP ${status}).`
            : timedOut
              ? "Baseten usage request timed out. Try refreshing later."
              : "Baseten usage could not be loaded. Check the key and try again.",
    };
  }
}

function normalize(providerId: ProviderId, payload: unknown): ProviderUsage {
  const root = object(payload) ?? {};
  const error = object(root.error);
  const usage = object(root.usage);
  const rateLabels = object(root.rateWindowLabels);
  const windows: ProviderUsage["windows"] = [];

  if (usage) {
    const labels = {
      primary: string(rateLabels?.primary) ?? "Session",
      secondary: string(rateLabels?.secondary) ?? "Weekly",
      tertiary: string(rateLabels?.tertiary) ?? "Monthly",
    };

    addWindow(windows, "primary", labels.primary, usage.primary);
    addWindow(windows, "secondary", labels.secondary, usage.secondary);
    addWindow(windows, "tertiary", labels.tertiary, usage.tertiary);

    const seenLabels = new Set(windows.map((window) => window.label.toLowerCase()));
    for (const item of Array.isArray(usage.extraRateWindows) ? usage.extraRateWindows : []) {
      const entry = object(item);
      if (!entry) continue;
      const title = string(entry.title);
      // Providers also report internal model-pool lanes such as `gpt-reserve`, whose
      // title is an identifier rather than a quota name. Those mirror the main window
      // and are not user-facing limits, so keep them out of the surface.
      if (title && !/\s/.test(title) && /[-_]/.test(title)) continue;
      const label = title ?? "Additional limit";
      if (seenLabels.has(label.toLowerCase())) continue;
      seenLabels.add(label.toLowerCase());
      addWindow(windows, string(entry.id) ?? `extra-${windows.length}`, label, entry.window);
    }
  }

  const identity = object(usage?.identity);
  const plan =
    string(usage?.plan) ??
    string(usage?.planLabel) ??
    string(usage?.loginMethod) ??
    string(identity?.loginMethod);
  return {
    id: providerId,
    name: names[providerId],
    source: string(root.source),
    account:
      string(usage?.accountEmail) ??
      string(identity?.accountEmail) ??
      string(root.account),
    plan,
    updatedAt: string(usage?.updatedAt) ?? string(root.updatedAt),
    windows,
    error: error ? (string(error.message) ?? "Usage unavailable") : null,
    spend: error ? null : readProviderSpend(usage),
  };
}

// Only Claude borrows a login from OMP. Antigravity is deliberately absent: reusing a Google
// OAuth token from a third-party client is what Antigravity's terms prohibit.
const ompProviders = {
  claude: "anthropic",
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
  const token = accessToken;
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

async function resolveOmpAuth(
  providerId: keyof typeof ompProviders,
  forceRefresh: boolean,
): Promise<ResolvedAuth | null> {
  try {
    const { env, directory } = await createCodexBarEnvironment(providerId, forceRefresh);
    return { env, directory, source: "oauth" };
  } catch {
    return null;
  }
}

/**
 * Claude is read with an OAuth token borrowed from OMP; Codex reads its own CLI login.
 * The other providers no longer go through CodexBar.
 */
async function resolveAuth(
  providerId: ProviderId,
  forceRefresh: boolean,
): Promise<ResolvedAuth> {
  const ambient: ResolvedAuth = { env: process.env, directory: null, source: "auto" };
  if (providerId !== "claude") return ambient;
  return (await resolveOmpAuth(providerId, forceRefresh)) ?? ambient;
}

const codexBarInstallHint =
  "CodexBar CLI not found. Install it from https://github.com/steipete/CodexBar/releases " +
  "(CodexBarCLI tarball) into ~/.local/bin or another PATH directory, or set CODEXBAR_BIN.";

/**
 * Finds a CLI by name: PATH, then common install directories. A missing binary is a
 * normal state, so this returns null rather than throwing.
 */
async function findBinary(name: string, extraDirectories: string[] = []): Promise<string | null> {
  const directories = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...extraDirectories,
  ];
  for (const directory of directories) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next directory.
    }
  }
  return null;
}

/** Finds the CodexBar CLI: CODEXBAR_BIN, then PATH, then common install directories. */
async function findCodexBar(): Promise<string | null> {
  const override = process.env.CODEXBAR_BIN;
  if (override) return override;
  return findBinary("codexbar", ["/Applications/CodexBar.app/Contents/Helpers"]);
}

async function runCodexBar(
  providerId: ProviderId,
  forceRefresh: boolean,
  authOverride?: ResolvedAuth,
): Promise<ProviderUsage> {
  let temporaryDirectory: string | null = null;
  try {
    const binary = await findCodexBar();
    if (!binary) throw new Error(codexBarInstallHint);
    const auth = authOverride ?? (await resolveAuth(providerId, forceRefresh));
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
      ...emptyUsage(providerId),
      error:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? codexBarInstallHint
          : error.message === codexBarInstallHint
            ? codexBarInstallHint
            : (error as NodeJS.ErrnoException).code === "ETIMEDOUT" ||
                (error as Error & { killed?: boolean }).killed
              ? "CodexBar usage request timed out. Try refreshing later."
              : "CodexBar could not load usage. Check its configuration and try again.",
    };
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

/* ========================================================================== */
/* Antigravity                                                                */
/* ========================================================================== */

/**
 * Antigravity is read from Google's own CLI in print mode, never from a Google token:
 *
 *   agy --print /usage   --output-format json   quota buckets per model group
 *   agy --print /credits --output-format json   remaining AI credits
 *
 * Google documents print mode for scripts (https://antigravity.google/docs/cli/headless),
 * lists /usage and /credits as commands the CLI answers itself
 * (https://antigravity.google/docs/cli/commands/usage, .../credits), and says such a command
 * runs as its own `--print` invocation. Neither sends a model prompt (`num_turns: 0`). The JSON
 * shapes below were captured from agy 1.5.5 on 2026-11-10.
 *
 * Deliberately not used: any Google OAuth token (including OMP's google-antigravity login) and
 * cloudcode-pa.googleapis.com. Clause 6 of the Antigravity terms (https://antigravity.google/terms)
 * makes reaching the service through third-party tools with Antigravity OAuth a breach, and the
 * Google AI forum documents account suspensions. For the same reason agy runs at most once per
 * `agyHoldMs` unless the user presses Refresh, and never in a loop.
 *
 * Why there is no plan tier: `plan_tier` exists only in the interactive status-line payload
 * (https://antigravity.google/docs/cli/statusline). Neither print-mode report names a tier or
 * an account, and the ACP server reports no quota at all (google-antigravity/antigravity-cli#1045).
 */
const agyHoldMs = 15 * 60_000;
const agyTimeoutMs = 60_000;
const agyMaxOutputChars = 1024 * 1024;

const agySetupHint =
  "Antigravity CLI (agy) was not found. Install it from https://antigravity.google/download, run " +
  "`agy` once in a terminal to sign in, or set ANTIGRAVITY_CLI_PATH.";

const agySignedOutHint =
  "Antigravity CLI is signed out. Run `agy` once in a terminal and sign in. The plugin never " +
  "opens a browser or reads Google tokens.";

type AgyFailure = "signed-out" | "timeout" | "failed";

class AgyError extends Error {
  readonly failure: AgyFailure;
  constructor(failure: AgyFailure) {
    super(`agy ${failure}`);
    this.failure = failure;
  }
}

type CapturedProcess = { stdout: string; stderr: string; exitCode: number | null };

/**
 * Runs a child in its own process group and captures its output. The group is stopped when
 * the child exits, times out, or prints too much, so helpers it spawned (agy can start MCP
 * servers) never outlive the call.
 */
function captureProcess(
  binary: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  timeoutMs: number,
): Promise<CapturedProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { ...options, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const stopGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group already exited.
      }
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopGroup("SIGTERM");
      action();
    };
    const timer = setTimeout(() => {
      stopGroup("SIGKILL");
      finish(() => reject(new AgyError("timeout")));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > agyMaxOutputChars) {
        stopGroup("SIGKILL");
        finish(() => reject(new AgyError("failed")));
      }
    });
    // stderr is only matched for the signed-out phrases, never surfaced.
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (exitCode) => finish(() => resolve({ stdout, stderr, exitCode })));
  });
}

const agySignedOutPattern =
  /authentication required|not logged into antigravity|expired or revoked|authentication failed or timed out/i;

/**
 * Runs one print-mode slash command. agy updates itself and writes a log on every run, and
 * can start Google OAuth in a browser when its sign-in has lapsed, so each run gets: auto-update
 * off (the value must be the word `true`), no log file, an empty private working directory, and
 * launchers that fail instead of opening a browser.
 */
async function runAgyCommand(binary: string, command: "/usage" | "/credits"): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), "paseo-provider-usage-agy-"));
  try {
    const launchers = join(directory, "bin");
    const workdir = join(directory, "cwd");
    await mkdir(launchers);
    await mkdir(workdir);
    for (const name of ["open", "xdg-open"]) {
      await writeFile(join(launchers, name), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    }
    const { stdout, stderr, exitCode } = await captureProcess(
      binary,
      ["--print", command, "--output-format", "json", "--log-file", devNull],
      {
        cwd: workdir,
        env: {
          ...process.env,
          AGY_CLI_DISABLE_AUTO_UPDATE: "true",
          BROWSER: join(launchers, "open"),
          PATH: `${launchers}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
      agyTimeoutMs,
    );
    let envelope: unknown = null;
    try {
      envelope = JSON.parse(stdout);
    } catch {
      // Handled below as a failure.
    }
    const root = object(envelope);
    if (exitCode === 0 && root && string(root.status) === "SUCCESS") return envelope;
    const signedOut = agySignedOutPattern.test(`${stderr} ${string(root?.error) ?? ""}`);
    throw new AgyError(signedOut ? "signed-out" : "failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function isoTimestamp(value: unknown): string | null {
  const text = string(value);
  return text !== null && !Number.isNaN(Date.parse(text)) ? text : null;
}

const agyFamilyLabels: Record<string, string> = {
  "gemini models": "Gemini",
  "claude and gpt models": "Claude/GPT",
};

function agyFamilyLabel(groupName: string): string {
  return agyFamilyLabels[groupName.toLowerCase()] ?? (groupName.replace(/\s+models?$/i, "").trim() || groupName);
}

function agyWindowLabel(windowName: string | null, bucketName: string | null): { label: string; minutes: number | null } {
  if (windowName === "weekly") return { label: "weekly", minutes: 10080 };
  if (windowName === "5h") return { label: "5-hour", minutes: 300 };
  const fallback = (bucketName ?? windowName ?? "limit").replace(/\s+limit remaining$/i, "").toLowerCase();
  return { label: fallback, minutes: null };
}

type AgyQuota = {
  windows: ProviderUsage["windows"];
  /** Buckets that report an amount but no fraction, so they cannot draw a bar. */
  rows: SpendRow[];
  /** Each bucket that is switched off right now, with the provider's own explanation. */
  inactive: { label: string; description: string | null }[];
  /** Google lists five-hour limits for Google AI Pro and Ultra only. */
  hasFiveHour: boolean;
};

/**
 * Maps `command.data.groups[].buckets[]` from `/usage`. `remaining_fraction` becomes the used
 * share. A bucket marked `disabled` is not in effect (agy says why in `description`), so its
 * placeholder fraction is not drawn. An untouched bucket (fraction 1) reports "now plus its
 * window" as `reset_time`, which moves on every read, so it gets no reset timestamp and the
 * surface falls back to the window length.
 */
function readAgyQuota(envelope: unknown): AgyQuota | null {
  const command = object(object(envelope)?.command);
  if (string(command?.name) !== "usage") return null;
  const groups = object(command?.data)?.groups;
  if (!Array.isArray(groups)) return null;

  const quota: AgyQuota = { windows: [], rows: [], inactive: [], hasFiveHour: false };
  for (const item of groups) {
    const group = object(item);
    const groupName = string(group?.name);
    if (!group || !groupName) continue;
    const family = agyFamilyLabel(groupName);
    const buckets = (Array.isArray(group.buckets) ? group.buckets : [])
      .map(object)
      .filter((bucket): bucket is JsonObject => bucket !== null)
      .sort((a, b) => Number(string(b.window) === "5h") - Number(string(a.window) === "5h"));
    for (const bucket of buckets) {
      const windowName = string(bucket.window);
      const { label: windowLabel, minutes } = agyWindowLabel(windowName, string(bucket.name));
      const label = `${family} ${windowLabel}`;
      if (windowName === "5h") quota.hasFiveHour = true;
      if (bucket.disabled === true) {
        quota.inactive.push({ label, description: string(bucket.description)?.slice(0, 280) ?? null });
        continue;
      }
      const remaining = number(bucket.remaining_fraction);
      if (remaining === null) {
        const amount = number(bucket.remaining_amount);
        if (amount !== null) quota.rows.push({ label, value: `${creditNumber.format(amount)} remaining` });
        continue;
      }
      quota.windows.push({
        id: `antigravity-${string(bucket.id) ?? `${family}-${windowLabel}`}`,
        label,
        usedPercent: Math.max(0, Math.min(100, (1 - remaining) * 100)),
        resetsAt: remaining >= 1 ? null : isoTimestamp(bucket.reset_time),
        resetDescription: null,
        windowMinutes: minutes,
      });
    }
  }
  return quota.windows.length > 0 || quota.rows.length > 0 || quota.inactive.length > 0 ? quota : null;
}

/** `/credits` reports `command.data.remaining_credits`; a missing or non-numeric value stays missing. */
function readAgyCredits(envelope: unknown): number | null {
  const command = object(object(envelope)?.command);
  if (string(command?.name) !== "credits") return null;
  return number(object(command?.data)?.remaining_credits);
}

/**
 * Whether agy may spend AI credits once the plan quota runs out: `useG1Credits` in agy's own
 * settings file. Google documents the key and its default of off
 * (https://antigravity.google/docs/cli/reference#configuration-keys-settingsjson). Unknown
 * when the file is missing, so the row is omitted instead of guessed.
 */
async function readAgyOverageSetting(): Promise<boolean | null> {
  const settings = object(await readJsonFile(join(homedir(), ".gemini", "antigravity-cli", "settings.json")));
  if (!settings) return null;
  return typeof settings.useG1Credits === "boolean" ? settings.useG1Credits : false;
}

function composeAntigravity(
  usageEnvelope: unknown,
  creditsEnvelope: unknown,
  overage: boolean | null,
  now: Date,
): ProviderUsage {
  const base: ProviderUsage = { ...emptyUsage("antigravity"), source: "cli", updatedAt: now.toISOString() };
  const quota = readAgyQuota(usageEnvelope);
  if (!quota) return { ...base, error: "Antigravity CLI reported no quota buckets." };

  const credits = readAgyCredits(creditsEnvelope);
  const creditRows: SpendRow[] = [
    credits === null ? unavailableRow("Remaining") : { label: "Remaining", value: creditNumber.format(credits) },
  ];
  if (overage !== null) creditRows.push({ label: "Used after quota ends", value: overage ? "On" : "Off" });

  const groups: SpendGroup[] = [];
  if (quota.rows.length > 0) groups.push({ kind: "limits", title: "Quota amounts", rows: quota.rows });
  // A switched-off lane sits with the limits, in words, so it is never read as a 0% bar.
  for (const lane of quota.inactive) {
    groups.push({
      kind: "limits",
      title: lane.label,
      rows: [{ label: lane.label, value: "Not in effect" }],
      note: lane.description,
    });
  }
  groups.push(
    {
      kind: "plan",
      title: "Plan",
      rows: [unavailableRow("Tier")],
      note:
        "agy reports the plan tier only in its interactive status line." +
        (quota.hasFiveHour ? " Five-hour limits exist here; Google lists them for Pro and Ultra plans only." : ""),
    },
    {
      kind: "balance",
      title: "AI credits",
      rows: creditRows,
      note: "Credits apply only after the plan quota is used up, and only when the overage setting is on.",
    },
  );
  return { ...base, windows: quota.windows, spend: { groups, note: null } };
}


/** ANTIGRAVITY_CLI_PATH is authoritative when set, like CodexBar's own override. */
async function findAgy(): Promise<string | null> {
  const override = string(process.env.ANTIGRAVITY_CLI_PATH);
  if (override) {
    try {
      await access(override, constants.X_OK);
      return override;
    } catch {
      return null;
    }
  }
  return findBinary("agy");
}

async function readAntigravity(binary: string): Promise<ProviderUsage> {
  try {
    const usageEnvelope = await runAgyCommand(binary, "/usage");
    let creditsEnvelope: unknown = null;
    try {
      creditsEnvelope = await runAgyCommand(binary, "/credits");
    } catch {
      // The quota still renders; the credits row then says the balance is unavailable.
    }
    return composeAntigravity(usageEnvelope, creditsEnvelope, await readAgyOverageSetting(), new Date());
  } catch (cause) {
    const failure = cause instanceof AgyError ? cause.failure : "failed";
    return {
      ...emptyUsage("antigravity"),
      source: "cli",
      error:
        failure === "signed-out"
          ? agySignedOutHint
          : failure === "timeout"
            ? "Antigravity CLI timed out reporting usage. Try refreshing later."
            : "Antigravity CLI could not report usage. Run `agy` in a terminal to check its sign-in.",
    };
  }
}

async function fetchAntigravity(force: boolean): Promise<ProviderUsage> {
  const binary = await findAgy();
  if (!binary) return { ...emptyUsage("antigravity"), error: agySetupHint };
  return withHold("agy", agyHoldMs, force, () => readAntigravity(binary));
}

/* ========================================================================== */
/* OpenRouter                                                                 */
/* ========================================================================== */

/**
 * OpenRouter is read straight from its API:
 *
 *   GET /api/v1/credits   total_credits and total_usage (lifetime, USD)
 *   GET /api/v1/activity  one row per day, model, and endpoint for the last 30 completed UTC
 *                         days: usage (USD), byok_usage_inference, requests, token counts
 *
 * https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity requires a Management
 * key, and the credits page says the same. Observed 2026-11-10: a regular key read /credits
 * (HTTP 200) but got 403 on /activity, so per-model spend needs a Management key. There is no
 * other OpenRouter endpoint that splits spend by model: /key reports one key's own totals and
 * /generation reports one request.
 *
 * Credentials: only OpenRouter keys are candidates, tried in this order, and they are sent only
 * to openrouter.ai: OPENROUTER_MANAGEMENT_API_KEY, the key CodexBar stored for its openrouter
 * provider, then OPENROUTER_API_KEY. An OpenAI or any other provider's key can never work here
 * and is never read.
 */
const openRouterApiBase = "https://openrouter.ai/api/v1";
const openRouterModelRows = 8;

const openRouterSetup =
  "OpenRouter needs an API key. Run `codexbar config set-api-key --provider openrouter --stdin` and " +
  "paste an OpenRouter Management key, or set OPENROUTER_MANAGEMENT_API_KEY for the Paseo daemon.";

const openRouterKeyHint =
  "OpenRouter rejected the saved API key. Create a new one at https://openrouter.ai/settings/keys " +
  "(a Management key at https://openrouter.ai/settings/management-keys for per-model spend).";

const openRouterManagementHint =
  "Per-model spend needs an OpenRouter Management key (GET /api/v1/activity rejects regular keys): run " +
  "`codexbar config set-api-key --provider openrouter --stdin` and paste one, or set " +
  "OPENROUTER_MANAGEMENT_API_KEY for the Paseo daemon.";

function codexBarConfigPaths(): string[] {
  const configured = string(process.env.CODEXBAR_CONFIG);
  if (configured) return [configured];
  const xdg = string(process.env.XDG_CONFIG_HOME);
  return [
    ...(xdg && isAbsolute(xdg) ? [join(xdg, "codexbar", "config.json")] : []),
    join(homedir(), ".config", "codexbar", "config.json"),
    join(homedir(), ".codexbar", "config.json"),
  ];
}

/** Reuses the key CodexBar already stores; the first config file that exists decides. */
async function readCodexBarOpenRouterKey(): Promise<string | null> {
  for (const path of codexBarConfigPaths()) {
    const config = object(await readJsonFile(path));
    if (!config) continue;
    const entry = (Array.isArray(config.providers) ? config.providers : [])
      .map(object)
      .find((provider) => provider?.id === "openrouter");
    return string(entry?.apiKey)?.trim() ?? null;
  }
  return null;
}

async function readOpenRouterKeys(): Promise<string[]> {
  const candidates = [
    string(process.env.OPENROUTER_MANAGEMENT_API_KEY)?.trim(),
    await readCodexBarOpenRouterKey(),
    string(process.env.OPENROUTER_API_KEY)?.trim(),
  ];
  return [...new Set(candidates.filter((key): key is string => Boolean(key)))];
}

type KeyedRead =
  | { ok: true; payload: unknown; key: string }
  | { ok: false; status: number | null; timedOut: boolean };

/** Tries each key in turn; only a 401 or 403 moves on, because only those are about the key. */
async function readWithAnyKey(url: string, keys: string[], timeoutMs: number): Promise<KeyedRead> {
  let failure: KeyedRead = { ok: false, status: null, timedOut: false };
  for (const key of keys) {
    try {
      return { ok: true, payload: await fetchProviderJson(url, key, timeoutMs), key };
    } catch (cause) {
      const status = cause instanceof HttpStatusError ? cause.status : null;
      failure = { ok: false, status, timedOut: (cause as Error | undefined)?.name === "TimeoutError" };
      if (status !== 401 && status !== 403) break;
    }
  }
  return failure;
}

function readOpenRouterCredits(payload: unknown): { total: number; used: number } | null {
  const data = object(object(payload)?.data);
  const total = number(data?.total_credits);
  const used = number(data?.total_usage);
  return total !== null && used !== null ? { total, used } : null;
}

type OpenRouterActivity = {
  models: { model: string; usd: number; requests: number }[];
  usd: number;
  byokUsd: number;
  requests: number;
  tokens: number;
};

/** Sums the per-day, per-endpoint rows by model. Token totals are prompt plus completion. */
function readOpenRouterActivity(payload: unknown): OpenRouterActivity | null {
  const rows = object(payload)?.data;
  if (!Array.isArray(rows)) return null;
  const byModel = new Map<string, { model: string; usd: number; requests: number }>();
  const total: OpenRouterActivity = { models: [], usd: 0, byokUsd: 0, requests: 0, tokens: 0 };
  for (const item of rows) {
    const row = object(item);
    const model = string(row?.model);
    if (!row || !model) continue;
    const usd = number(row.usage) ?? 0;
    const requests = number(row.requests) ?? 0;
    const entry = byModel.get(model) ?? { model, usd: 0, requests: 0 };
    entry.usd += usd;
    entry.requests += requests;
    byModel.set(model, entry);
    total.usd += usd;
    total.byokUsd += number(row.byok_usage_inference) ?? 0;
    total.requests += requests;
    total.tokens += (number(row.prompt_tokens) ?? 0) + (number(row.completion_tokens) ?? 0);
  }
  total.models = [...byModel.values()];
  return total;
}

function formatSpend(value: number): string {
  return value > 0 && value < 0.005 ? "<$0.01" : formatUsd(value);
}

function composeOpenRouterSpend(
  credits: { total: number; used: number } | null,
  activity: OpenRouterActivity | null,
  notes: string[],
): ProviderUsage["spend"] {
  const groups: SpendGroup[] = [];
  if (credits) {
    groups.push({
      kind: "balance",
      title: "Credits",
      rows: [
        { label: "Remaining", value: formatUsd(credits.total - credits.used) },
        { label: "Used", value: formatUsd(credits.used) },
        { label: "Total added", value: formatUsd(credits.total) },
      ],
    });
  }
  if (activity) {
    const paid = activity.models.filter((entry) => entry.usd > 0).sort((a, b) => b.usd - a.usd);
    const rows: SpendRow[] = [{ label: "Spend", value: formatSpend(activity.usd) }];
    if (activity.byokUsd > 0) rows.push({ label: "BYOK (billed by the model provider)", value: formatSpend(activity.byokUsd) });
    groups.push({ kind: "spend", title: "Last 30 completed UTC days", rows });
    groups.push({
      kind: "detail",
      title: "Activity, last 30 completed UTC days",
      rows: [
        { label: "Requests", value: compactNumber.format(activity.requests) },
        { label: "Tokens", value: compactNumber.format(activity.tokens) },
        { label: "Models", value: String(activity.models.length) },
      ],
    });
    if (paid.length > 0) {
      // Each share is measured against the whole 30-day spend, so the bars add up to 100%.
      const modelRows: SpendRow[] = paid.slice(0, openRouterModelRows).map((entry) => ({
        label: entry.model,
        value: formatSpend(entry.usd),
        detail: `${compactNumber.format(entry.requests)} req`,
        share: shareOf(entry.usd, activity.usd),
      }));
      const rest = paid.slice(openRouterModelRows);
      if (rest.length > 0) {
        const restUsd = rest.reduce((sum, entry) => sum + entry.usd, 0);
        modelRows.push({
          label: `Other (${rest.length} models)`,
          value: formatSpend(restUsd),
          detail: `${compactNumber.format(rest.reduce((sum, entry) => sum + entry.requests, 0))} req`,
          share: shareOf(restUsd, activity.usd),
        });
      }
      groups.push({ kind: "breakdown", title: "Spend by model", rows: modelRows });
    }
    notes.push(
      "Per-model spend comes from OpenRouter's Activity API: the last 30 completed UTC days, " +
        "today excluded, so it can trail the lifetime Used figure.",
    );
  }
  const headline = credits
    ? { label: "Credits remaining", value: formatUsd(credits.total - credits.used) }
    : activity
      ? { label: "Spent, last 30 completed UTC days", value: formatSpend(activity.usd) }
      : null;
  return { groups, note: notes.length > 0 ? notes.join(" ") : null, headline };
}

async function fetchOpenRouter(): Promise<ProviderUsage> {
  const empty = emptyUsage("openrouter");
  const keys = await readOpenRouterKeys();
  if (keys.length === 0) return { ...empty, error: openRouterSetup };

  const [activity, credits] = await Promise.all([
    readWithAnyKey(`${openRouterApiBase}/activity`, keys, 30_000),
    readWithAnyKey(`${openRouterApiBase}/credits`, keys, 20_000),
  ]);
  const failureText = (read: Extract<KeyedRead, { ok: false }>, what: string): string =>
    read.status !== null
      ? `${what} could not be loaded (HTTP ${read.status}).`
      : read.timedOut
        ? `${what} request timed out. Try refreshing later.`
        : `${what} could not be loaded.`;

  if (!activity.ok && !credits.ok) {
    const rejected = [activity, credits].every((read) => !read.ok && (read.status === 401 || read.status === 403));
    return { ...empty, source: "api", error: rejected ? openRouterKeyHint : failureText(credits, "OpenRouter usage") };
  }

  const notes: string[] = [];
  if (!activity.ok) {
    notes.push(activity.status === 401 || activity.status === 403 ? openRouterManagementHint : failureText(activity, "Per-model spend"));
  }
  if (!credits.ok) notes.push(failureText(credits, "The credit balance"));
  const parsedActivity = activity.ok ? readOpenRouterActivity(activity.payload) : null;
  const parsedCredits = credits.ok ? readOpenRouterCredits(credits.payload) : null;
  if (activity.ok && !parsedActivity) notes.push("OpenRouter's activity response was not in the expected shape.");
  if (credits.ok && !parsedCredits) notes.push("OpenRouter's credits response was not in the expected shape.");
  return {
    ...empty,
    source: "api",
    updatedAt: new Date().toISOString(),
    spend: composeOpenRouterSpend(parsedCredits, parsedActivity, notes),
  };
}

/* ========================================================================== */
/* OpenCode Go                                                                */
/* ========================================================================== */

/**
 * OpenCode Go is read with the OpenCode Go key, from OpenCode's console API:
 *
 *   GET /console/api/go/status             plan (`product`), per-window used and limit in
 *                                          micro-cents (1e-8 USD), period end
 *   GET /console/api/usage/summary?range=30d   30-day API-rate cost, requests, tokens
 *   GET /console/api/billing/status        pay-as-you-go balance (`balanceMicroCents`)
 *
 * https://opencode.ai/docs/console/api says console API keys carry scoped permissions
 * (Usage: Read, Billing: Read, ...) and that a request outside them returns HTTP 403. These
 * routes are not listed in the public docs, so they could change without notice; CodexBar's
 * OpenCode provider uses the same three (https://github.com/steipete/CodexBar/blob/main/docs/opencode.md).
 * Observed 2026-11-10 with the stored Go key: go/status 200 (plan "go", $12 / $30 / $60 limits),
 * usage/summary 200, billing/status 403 Forbidden, so that key lacks Billing: Read. With a personal
 * key created for this plugin (Console > Account > Personal API keys; Usage: Read, Billing: Read,
 * Models: None, everything else None) all four routes answered 200 and the inference models list
 * answered 403, so the key can read but cannot call models. billing/status then returned
 * { billingMode: "prepaid", mode: "pay-as-you-go", balanceMicroCents: "0", availableMicroCents: "0",
 * creditLimitMicroCents: null, canPurchaseCredits, canEnableAutoRecharge }. Only `balanceMicroCents`
 * is read; `availableMicroCents` is a separate credit value, per CodexBar's notes.
 *
 * Fallbacks, in order: GET https://opencode.ai/zen/go/v1/usage (percent and reset per window,
 * from the open-source console route anomalyco/opencode packages/console/app/src/routes/zen/go/v1/usage.ts;
 * it reports an idle rolling window's reset as "now plus 5 hours", so a 0% rolling window gets no
 * reset time), then CodexBar's local-activity estimate, marked as an estimate. On 2026-11-10 that
 * estimate read 0/0/0 where the server said 0/6/5.
 *
 * Credential: the OpenCode Go key OpenCode already stores. Order: OPENCODE_API_KEY, OpenCode's
 * own login (`opencode-go` in its auth.json), then Pi's `opencode-go` login. It is sent only to
 * opencode.ai. The plugin never reads browser cookies and never creates keys.
 */
const openCodeConsoleBase = "https://opencode.ai/console/api";
const openCodeGoUsageUrl = "https://opencode.ai/zen/go/v1/usage";

const openCodeGoMeters = [
  { meter: "fiveHour", id: "rolling", label: "5-hour", minutes: 300 },
  { meter: "week", id: "weekly", label: "Weekly", minutes: 10080 },
  { meter: "month", id: "monthly", label: "Monthly", minutes: null },
] as const;

const openCodeGoPlans: Record<string, string> = {
  go: "Go",
  "go-plus": "Go Plus",
  go_plus: "Go Plus",
  "go-teams": "Go Teams",
  go_teams: "Go Teams",
};

const microCentsPerUsd = 100_000_000;

async function readOpenCodeGoKey(): Promise<string | null> {
  const fromEnvironment = string(process.env.OPENCODE_API_KEY)?.trim();
  if (fromEnvironment) return fromEnvironment;
  const paths = [
    join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "auth.json"),
    join(homedir(), ".pi", "agent", "auth.json"),
  ];
  for (const path of paths) {
    const key = string(object(object(await readJsonFile(path))?.["opencode-go"])?.key)?.trim();
    if (key) return key;
  }
  return null;
}

type OpenCodeGoStatus = {
  plan: string | null;
  /** Each window carries its dollars used and allowed as `amount`, from the same micro-cent meters. */
  windows: ProviderUsage["windows"];
  periodEnd: string | null;
  ending: boolean;
};

/** Used share is the provider's own used and limit amounts divided, so it is exact, not floored. */
function readOpenCodeGoStatus(payload: unknown): OpenCodeGoStatus | null {
  const root = object(payload);
  const access = object(root?.access);
  const meters = object(access?.meters);
  if (!meters) return null;
  const windows: ProviderUsage["windows"] = [];
  for (const definition of openCodeGoMeters) {
    const meter = object(meters[definition.meter]);
    const limit = money(meter?.limitMicroCents);
    const used = money(meter?.usedMicroCents);
    if (!meter || limit === null || used === null || limit <= 0) continue;
    windows.push({
      id: definition.id,
      label: definition.label,
      usedPercent: Math.max(0, Math.min(100, (used / limit) * 100)),
      resetsAt: isoTimestamp(meter.resetsAt) ?? (definition.meter === "month" ? isoTimestamp(access?.endsAt) : null),
      resetDescription: null,
      windowMinutes: definition.minutes,
      amount: `${formatUsd(used / microCentsPerUsd)} of ${formatUsd(limit / microCentsPerUsd)}`,
    });
  }
  if (windows.length === 0) return null;
  const product = string(root?.product)?.toLowerCase() ?? null;
  return {
    plan: product ? (openCodeGoPlans[product] ?? product) : null,
    windows,
    periodEnd: isoTimestamp(access?.endsAt),
    ending: access?.cancelAtPeriodEnd === true || root?.cancelAtPeriodEnd === true,
  };
}

function readOpenCodeGoSummary(payload: unknown): SpendRow[] | null {
  const root = object(payload);
  const cost = money(root?.totalCostMicroCents);
  if (!root || cost === null) return null;
  const rows: SpendRow[] = [{ label: "API-rate cost", value: formatSpend(cost / microCentsPerUsd) }];
  const counts: [string, unknown][] = [
    ["Requests", root.totalRequests],
    ["Input tokens", root.totalInputTokens],
    ["Output tokens", root.totalOutputTokens],
    ["Cached input tokens", root.totalCacheReadTokens],
  ];
  for (const [label, value] of counts) {
    const count = money(value);
    if (count !== null) rows.push({ label, value: compactNumber.format(count) });
  }
  return rows;
}

function readOpenCodeGoBalance(payload: unknown): number | null {
  const balance = money(object(payload)?.balanceMicroCents);
  return balance === null ? null : balance / microCentsPerUsd;
}

/** The older percent-only route, used when the console routes cannot supply the windows. */
function readOpenCodeGoUsage(payload: unknown): ProviderUsage["windows"] | null {
  const usage = object(object(payload)?.usage);
  if (!usage) return null;
  const windows: ProviderUsage["windows"] = [];
  for (const definition of openCodeGoMeters) {
    const entry = object(usage[definition.id]);
    const percent = number(entry?.percent);
    if (!entry || percent === null) continue;
    windows.push({
      id: definition.id,
      label: definition.label,
      usedPercent: Math.max(0, Math.min(100, string(entry.status) === "rate-limited" ? 100 : percent)),
      resetsAt: definition.id === "rolling" && percent === 0 ? null : isoTimestamp(entry.resetsAt),
      resetDescription: null,
      windowMinutes: definition.minutes,
    });
  }
  return windows.length > 0 ? windows : null;
}

const openCodeBillingHint =
  "This key cannot read billing. Set OPENCODE_API_KEY for the Paseo daemon to an OpenCode personal API key " +
  "with Usage: Read and Billing: Read (Console > Account > Personal API keys) to show the balance.";

type OpenCodeGoReads = {
  status: OpenCodeGoStatus | null;
  windows: ProviderUsage["windows"];
  summary: SpendRow[] | null;
  billing: ApiRead;
};

function composeOpenCodeGo({ status, windows, summary, billing }: OpenCodeGoReads): ProviderUsage {
  const groups: SpendGroup[] = [];
  const planRows: SpendRow[] = [status?.plan ? { label: "Tier", value: status.plan } : unavailableRow("Tier")];
  if (status?.periodEnd) planRows.push({ label: status.ending ? "Ends" : "Renews", value: formatExpiry(status.periodEnd) });
  groups.push({ kind: "plan", title: "Plan", rows: planRows });
  if (summary) {
    // readOpenCodeGoSummary lists the API-rate cost first, then the request and token counts.
    const [cost, ...counts] = summary;
    groups.push({ kind: "spend", title: "Last 30 days", rows: [cost] });
    if (counts.length > 0) groups.push({ kind: "detail", title: "Activity, last 30 days", rows: counts });
  }

  const balance = billing.ok ? readOpenCodeGoBalance(billing.payload) : null;
  if (balance !== null) {
    groups.push({ kind: "balance", title: "Pay-as-you-go balance", rows: [{ label: "Remaining", value: formatUsd(balance) }] });
  } else {
    groups.push({
      kind: "balance",
      title: "Pay-as-you-go balance",
      rows: [unavailableRow("Remaining")],
      note: billing.ok
        ? "OpenCode's billing response was not in the expected shape."
        : billing.status === 403
          ? openCodeBillingHint
          : `The balance could not be loaded (${describeFailure(billing)}).`,
    });
  }
  return {
    ...emptyUsage("opencodego"),
    source: "api",
    plan: status?.plan ?? null,
    updatedAt: new Date().toISOString(),
    windows,
    spend: {
      groups,
      note: status
        ? "Reported by OpenCode's console API with your Go key; those routes are not in OpenCode's public docs."
        : "Reported by OpenCode's usage endpoint, not estimated. Plan and dollar limits were not available from it.",
    },
  };
}

function openCodeGoEstimateSpend(note: string): NonNullable<ProviderUsage["spend"]> {
  return {
    groups: [
      { kind: "plan", title: "Plan", rows: [unavailableRow("Tier")] },
      { kind: "balance", title: "Pay-as-you-go balance", rows: [unavailableRow("Remaining")] },
    ],
    note,
  };
}

async function fetchOpenCodeGo(): Promise<ProviderUsage> {
  const key = await readOpenCodeGoKey();
  let reason: string;
  if (key) {
    const [statusRead, summaryRead, billing] = await Promise.all([
      readApi(`${openCodeConsoleBase}/go/status`, key),
      readApi(`${openCodeConsoleBase}/usage/summary?range=30d`, key),
      readApi(`${openCodeConsoleBase}/billing/status`, key),
    ]);
    const status = statusRead.ok ? readOpenCodeGoStatus(statusRead.payload) : null;
    const summary = summaryRead.ok ? readOpenCodeGoSummary(summaryRead.payload) : null;
    if (status) return composeOpenCodeGo({ status, windows: status.windows, summary, billing });

    const zen = await readApi(openCodeGoUsageUrl, key);
    const windows = zen.ok ? readOpenCodeGoUsage(zen.payload) : null;
    if (windows) return composeOpenCodeGo({ status: null, windows, summary, billing });
    if (!zen.ok && zen.status === 403 && zen.errorType === "EntitlementError") {
      return {
        ...emptyUsage("opencodego"),
        source: "api",
        error: "This OpenCode API key has no OpenCode Go subscription. Subscribe in the OpenCode Console or connect a Go key.",
      };
    }
    reason = !zen.ok
      ? `OpenCode's usage endpoints answered with ${describeFailure(zen)}`
      : "OpenCode's usage endpoints returned an unexpected response";
  } else {
    reason = "No OpenCode Go API key was found (OPENCODE_API_KEY, OpenCode's login, or Pi's login)";
  }

  const estimate = await runCodexBar("opencodego", false);
  return {
    ...estimate,
    windows: estimate.windows.map((window) => ({ ...window, estimated: true })),
    spend: estimate.error
      ? null
      : openCodeGoEstimateSpend(
          `${reason}, so these limits are estimated from local OpenCode Go activity and can differ from OpenCode's own figures.`,
        ),
  };
}

/* ========================================================================== */
/* Claude account                                                             */
/* ========================================================================== */

/**
 * Claude's usage windows still come from CodexBar. Its plan tier, prepaid credit balance, and
 * extra-usage spend are read from claude.ai's OAuth account endpoints, the ones Claude Code itself
 * uses for /usage:
 *
 *   GET https://api.anthropic.com/api/oauth/profile                              plan name, rate-limit tier
 *   GET https://api.anthropic.com/api/oauth/organizations/{org}/prepaid/credits  prepaid balance
 *   GET https://api.anthropic.com/api/oauth/usage                                `spend` block: extra usage
 *
 * Anthropic does not document these (its documented Usage and Cost API needs an Admin key and
 * reports API spend only: https://platform.claude.com/docs/en/manage-claude/usage-cost-api), so
 * they can change without notice. Field shapes follow
 * https://github.com/jens-duttke/usage-monitor-for-claude/blob/main/docs/api-reference.md and were
 * confirmed against a live Max account on 2026-11-10. Using them was an explicit decision by the
 * account owner.
 *
 * Credential: the OMP `anthropic` login, the same token the CodexBar path uses, sent only to
 * api.anthropic.com. The cached token is used first; a forced refresh (which invalidates the old
 * token) happens once, and only after a 401. The answer is held for `claudeAccountHoldMs`, and the
 * calls run after CodexBar's own Claude call so two token refreshes can never race.
 */
const anthropicApiBase = "https://api.anthropic.com";
const claudeAccountHoldMs = 10 * 60_000;
const claudeOauthHeaders = { "anthropic-beta": "oauth-2025-04-20" };

type ClaudeAccount = { plan: string | null; groups: SpendGroup[]; notes: string[] };

function minorUnits(value: unknown): { amount: number; currency: string | null } | null {
  const entry = object(value);
  const minor = number(entry?.amount_minor);
  if (minor === null) return null;
  return { amount: minor / 10 ** (number(entry?.exponent) ?? 2), currency: string(entry?.currency) };
}

function formatMoney(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", currency ? { style: "currency", currency } : { maximumFractionDigits: 2 }).format(amount);
  } catch {
    return formatCreditAmount(amount, currency);
  }
}

/** `default_claude_max_20x` becomes "Max 20x". Anything unrecognised is left out, not guessed. */
function claudeRateTier(raw: string | null): string | null {
  const match = /claude_(max|pro|team|enterprise)(?:_(\d+x))?$/i.exec(raw ?? "");
  if (!match) return null;
  const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  return match[2] ? `${name} ${match[2]}` : name;
}

function readClaudeProfile(payload: unknown): { orgId: string | null; plan: string | null; rows: SpendRow[] } | null {
  const org = object(object(payload)?.organization);
  if (!org) return null;
  const plan = string(org.plan_display_name);
  const rows: SpendRow[] = [plan ? { label: "Tier", value: plan } : unavailableRow("Tier")];
  const tier = claudeRateTier(string(org.rate_limit_tier));
  if (tier) rows.push({ label: "Rate limit tier", value: tier });
  const status = string(org.subscription_status);
  if (status) rows.push({ label: "Subscription", value: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") });
  return { orgId: string(org.uuid), plan, rows };
}

function readClaudePrepaid(payload: unknown): SpendRow[] | null {
  const root = object(payload);
  const balance = object(root?.balance);
  const remaining = minorUnits(balance?.money) ?? minorUnits(balance?.credits);
  if (!remaining) return null;
  const rows: SpendRow[] = [
    { label: "Remaining", value: formatMoney(remaining.amount, remaining.currency ?? string(root?.currency)) },
  ];
  const expiry = string(root?.next_expires_at);
  if (expiry) rows.push({ label: "Next expiry", value: formatExpiry(expiry) });
  return rows;
}

/** The `spend` block restates extra usage in explicit money objects, so no unit is guessed. */
function readClaudeExtraUsage(payload: unknown): SpendRow[] | null {
  const spend = object(object(payload)?.spend);
  if (!spend || typeof spend.enabled !== "boolean") return null;
  const reason = string(spend.disabled_reason)?.replace(/_/g, " ");
  const rows: SpendRow[] = [{ label: "Status", value: spend.enabled ? "On" : reason ? `Off (${reason})` : "Off" }];
  const used = minorUnits(spend.used);
  const limit = minorUnits(spend.limit);
  if (used) rows.push({ label: "Used this month", value: formatMoney(used.amount, used.currency) });
  if (limit) rows.push({ label: "Monthly limit", value: formatMoney(limit.amount, limit.currency) });
  return rows;
}

async function readClaudeAccount(): Promise<ClaudeAccount> {
  const missing: ClaudeAccount = {
    plan: null,
    groups: [
      { kind: "plan", title: "Plan", rows: [unavailableRow("Tier")] },
      { kind: "balance", title: "Prepaid credits", rows: [unavailableRow("Remaining")] },
    ],
    notes: [],
  };
  let token: string;
  try {
    token = await readAccessToken("claude", false);
  } catch {
    return { ...missing, notes: ["No OMP Anthropic login was available for Claude's account details."] };
  }

  let refreshed = false;
  const call = async (path: string): Promise<ApiRead> => {
    let read = await readApi(`${anthropicApiBase}${path}`, token, 20_000, claudeOauthHeaders);
    if (!read.ok && read.status === 401 && !refreshed) {
      refreshed = true;
      try {
        token = await readAccessToken("claude", true);
        read = await readApi(`${anthropicApiBase}${path}`, token, 20_000, claudeOauthHeaders);
      } catch {
        // Keep the 401; the note below reports it.
      }
    }
    return read;
  };

  const profileRead = await call("/api/oauth/profile");
  const profile = profileRead.ok ? readClaudeProfile(profileRead.payload) : null;
  const notes: string[] = [];
  if (!profile) {
    notes.push(
      profileRead.ok
        ? "Claude's profile response was not in the expected shape."
        : `Claude's plan could not be loaded (${describeFailure(profileRead)}).`,
    );
  }
  const [prepaidRead, usageRead] = await Promise.all([
    profile?.orgId
      ? call(`/api/oauth/organizations/${encodeURIComponent(profile.orgId)}/prepaid/credits`)
      : Promise.resolve<ApiRead | null>(null),
    call("/api/oauth/usage"),
  ]);

  const groups: SpendGroup[] = [{ kind: "plan", title: "Plan", rows: profile?.rows ?? [unavailableRow("Tier")] }];
  const prepaid = prepaidRead?.ok ? readClaudePrepaid(prepaidRead.payload) : null;
  groups.push({ kind: "balance", title: "Prepaid credits", rows: prepaid ?? [unavailableRow("Remaining")] });
  if (!prepaid && prepaidRead) {
    notes.push(
      prepaidRead.ok
        ? "Claude's prepaid credit response was not in the expected shape."
        : `Claude's prepaid balance could not be loaded (${describeFailure(prepaidRead)}).`,
    );
  }
  const extra = usageRead.ok ? readClaudeExtraUsage(usageRead.payload) : null;
  if (extra) groups.push({ kind: "spend", title: "Extra usage", rows: extra });
  else notes.push(usageRead.ok ? "Claude's extra-usage response was not in the expected shape." : `Claude's extra usage could not be loaded (${describeFailure(usageRead)}).`);
  notes.push("Plan, balance, and extra usage come from claude.ai's OAuth account endpoints, which Anthropic does not document.");
  return { plan: profile?.plan ?? null, groups, notes };
}

async function fetchClaude(force: boolean): Promise<ProviderUsage> {
  let usage = await runCodexBar("claude", false);
  if (isAuthenticationFailure(usage)) usage = await runCodexBar("claude", true);
  if (usage.error) return usage;
  const account = await withHold("claude-account", claudeAccountHoldMs, force, readClaudeAccount);
  const own = new Set(account.groups.map((group) => group.title));
  const noteParts = [usage.spend?.note, ...account.notes].filter((part): part is string => Boolean(part));
  return {
    ...usage,
    plan: usage.plan ?? account.plan,
    spend: {
      groups: [...account.groups, ...(usage.spend?.groups ?? []).filter((group) => !own.has(group.title))],
      note: noteParts.length > 0 ? noteParts.join(" ") : null,
    },
  };
}

async function fetchProvider(providerId: ProviderId, force: boolean): Promise<ProviderUsage> {
  if (providerId === "claude") return fetchClaude(force);
  if (providerId === "baseten") return fetchBaseten();
  if (providerId === "openrouter") return fetchOpenRouter();
  if (providerId === "antigravity") return fetchAntigravity(force);
  if (providerId === "opencodego") return fetchOpenCodeGo();

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
    // A plugin reload or daemon restart clears the in-memory holds. agy is the one source Google
    // may suspend an account over, so its last good answer keeps its hold across reloads.
    const agy = snapshot.providers.find((provider) => provider.id === "antigravity");
    const readAt = agy?.updatedAt ? Date.parse(agy.updatedAt) : Number.NaN;
    if (agy && !agy.error && Number.isFinite(readAt)) heldResults.set("agy", { at: readAt, value: agy });
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

function refresh(force = false): Promise<UsageSnapshot> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const snapshot: UsageSnapshot = {
      fetchedAt: new Date().toISOString(),
      providers: await Promise.all(providerIds.map((providerId) => fetchProvider(providerId, force))),
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
  if (force) return refresh(true);
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
    opencodego: "OpenCode Go",
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
  inode?: number;
  resumeOffset?: number;
  resumeLine?: number;
  resumeModel?: string;
  resumeProvider?: string;
  tailTurnCount?: number;
}

const analyticsCachePath = join(
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
  "paseo-provider-usage",
  "analytics-index.json",
);

const sessionFileCache = new Map<string, SessionCacheEntry>();
let analyticsCacheDirty = false;
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

    const append = cachedEntry && fileStat.size > cachedEntry.size &&
      cachedEntry.inode === fileStat.ino && cachedEntry.resumeOffset !== undefined &&
      cachedEntry.resumeLine !== undefined && cachedEntry.resumeModel !== undefined &&
      cachedEntry.resumeProvider !== undefined && cachedEntry.tailTurnCount !== undefined
      ? cachedEntry : null;
    const readOffset = append?.resumeOffset ?? 0;
    let raw = "";
    if (fileStat.size > readOffset) {
      // Bound the read to this snapshot and re-read any incomplete final line.
      const stream = createReadStream(filePath, {
        encoding: "utf8", start: readOffset, end: fileStat.size - 1,
      });
      for await (const chunk of stream) raw += chunk;
    }
    const lines = raw.split("\n");
    const baseLine = append?.resumeLine ?? 0;
    const turns: NormalizedTurn[] = append
      ? append.turns.slice(0, append.turns.length - append.tailTurnCount!) : [];
    let currentModel = append?.resumeModel ?? defaultModel;
    let currentProvider = append?.resumeProvider ?? defaultProvider;
    let resumeModel = currentModel;
    let resumeProvider = currentProvider;
    let turnsBeforeTail = turns.length;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (lineIndex === lines.length - 1) {
        resumeModel = currentModel;
        resumeProvider = currentProvider;
        turnsBeforeTail = turns.length;
      }
      const i = baseLine + lineIndex;
      const line = lines[lineIndex].trim();
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

    analyticsCacheDirty = true;
    sessionFileCache.set(filePath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      turns,
      inode: fileStat.ino,
      resumeOffset: readOffset + Buffer.byteLength(raw.slice(0, raw.lastIndexOf("\n") + 1)),
      resumeLine: baseLine + lines.length - 1,
      resumeModel,
      resumeProvider,
      tailTurnCount: turns.length - turnsBeforeTail,
    });
    return turns;
  } catch {
    return [];
  }
}

type DiscoveredTurns = {
  turns: NormalizedTurn[];
  agentsDiscovered: number;
  sessionsParsed: number;
};

let analyticsDiscovery: Promise<DiscoveredTurns> | null = null;

function discoverAllTurns(): Promise<DiscoveredTurns> {
  if (!analyticsDiscovery) {
    analyticsDiscovery = scanAllTurns().finally(() => {
      analyticsDiscovery = null;
    });
  }
  return analyticsDiscovery;
}

async function scanAllTurns(): Promise<DiscoveredTurns> {
  const allTurns: NormalizedTurn[] = [];
  let agentsDiscovered = 0;
  let sessionsParsed = 0;
  await restoreAnalyticsCache();
  const agentsRoot = join(homedir(), ".paseo", "agents");
  const agentPaths: string[] = [];

  try {
    const subdirs = await readdir(agentsRoot, { withFileTypes: true });
    for (const dir of subdirs) {
      if (!dir.isDirectory()) continue;
      const workspaceDir = join(agentsRoot, dir.name);
      try {
        const files = await readdir(workspaceDir);
        for (const file of files) {
          if (file.endsWith(".json")) agentPaths.push(join(workspaceDir, file));
        }
      } catch {}
    }
  } catch {}

  // Bound filesystem concurrency, including when most agents share one workspace.
  let nextAgent = 0;
  await Promise.all(Array.from({ length: Math.min(8, agentPaths.length) }, async () => {
    while (nextAgent < agentPaths.length) {
      const agentPath = agentPaths[nextAgent++];
      const file = basename(agentPath);
      agentsDiscovered++;
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
  }));

  // A filter change that reuses unchanged sessions should not serialize the entire index.
  if (analyticsCacheDirty) {
    analyticsCacheDirty = false;
    void persistAnalyticsCache();
  }
  return { turns: allTurns, agentsDiscovered, sessionsParsed };
}

/** UTC instant of local midnight, in `timeZone`, for the day containing `timestamp`. */
function startOfLocalDay(timestamp: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const parts = (ts: number) => {
    const values: Record<string, number> = {};
    for (const part of formatter.formatToParts(ts)) {
      if (part.type !== "literal") values[part.type] = Number(part.value);
    }
    return values;
  };
  const local = parts(timestamp);
  const midnightAsUtc = Date.UTC(local.year, local.month - 1, local.day);
  // Offset of the zone at a given instant: local wall-clock time read as UTC, minus the instant.
  const offsetAt = (ts: number) => {
    const p = parts(ts);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
  };
  const guess = midnightAsUtc - offsetAt(midnightAsUtc);
  return midnightAsUtc - offsetAt(guess);
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

  // Build every bucket up front so the chart has no gaps. Days start at local midnight in
  // `timeZone` (DST-safe), and the final bucket always contains `now`.
  const buckets: TokenTimeBucket[] = [];
  const hourMs = 3600 * 1000;
  const bucketStarts: number[] = [];
  if (bucketGranularity === "hour") {
    const currentHour = Math.floor(now / hourMs) * hourMs;
    for (let i = bucketCount - 1; i >= 0; i--) bucketStarts.push(currentHour - i * hourMs);
  } else {
    const today = startOfLocalDay(now, timeZone);
    // Step back from local noon so a 23- or 25-hour DST day never skips or repeats a date.
    for (let i = bucketCount - 1; i >= 0; i--) {
      bucketStarts.push(startOfLocalDay(today + 12 * hourMs - i * 86400 * 1000, timeZone));
    }
  }
  const alignedStart = bucketStarts[0];
  const stepMs = bucketGranularity === "hour" ? hourMs : 86400 * 1000;

  for (const slotTs of bucketStarts) {
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

    let bucketIdx = bucketStarts.length - 1;
    while (bucketIdx > 0 && bucketStarts[bucketIdx] > t.timestamp) bucketIdx--;
    if (bucketStarts[bucketIdx] <= t.timestamp) {
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
    const slotTs = bucketStarts[i];
    const slotEnd = bucketStarts[i + 1] ?? slotTs + stepMs;
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
