# Usage plugin: Antigravity, OpenRouter per-model spend, OpenCode Go, balances

Date: 2026-11-10.

## Decision

- No new key is needed. The OpenRouter key CodexBar already stores is a Management key (`GET /api/v1/key` reports `is_management_key: true`, and `/activity` answers 200 with it), so per-model spend works now.
- "The OpenAI key" is not involved. OpenRouter's per-model endpoint needs an OpenRouter Management key. An OpenAI or OpenAI Admin key cannot work there and is never read or sent.
- Antigravity no longer touches any Google token. The OMP `google-antigravity` fallback is removed, because Antigravity's terms (clause 6) ban third-party tools using Antigravity OAuth.
- Correction, same day: this report first said OpenCode Go had no plan or balance API and that the plugin would not call Claude's OAuth endpoints. Both were wrong or were reversed. OpenCode's console API accepts the Go key (plan and exact limits work now), and the project owner asked for Claude's undocumented OAuth endpoints, which work and are now used. See the two sections below.
- The OpenCode pay-as-you-go balance is readable with a key that has Billing: Read (see the OpenCode Go section). The running plugin only sees that key after the daemon restarts.

## Antigravity

Shown: quota lanes per model group (Gemini and Claude/GPT, 5-hour and weekly) with used share and reset; remaining AI credits (`0` today); whether credits are used after the quota ends (`Off`); a Plan row; the provider's own explanation when a lane is switched off.

- Source: `agy --print /usage --output-format json` and `agy --print /credits --output-format json`.
  Docs: [headless mode](https://antigravity.google/docs/cli/headless) ("slash commands answered by the CLI itself, such as /model and /usage, run as their own `--print` invocation"), [/usage](https://antigravity.google/docs/cli/commands/usage), [/credits](https://antigravity.google/docs/cli/commands/credits), [plans and overages](https://antigravity.google/docs/plans#overages).
- Credential: `agy`'s own sign-in. The plugin never sees a Google token.
- Guards: no model prompt (`num_turns: 0`), `AGY_CLI_DISABLE_AUTO_UPDATE=true`, `--log-file` to the null device, empty private working directory, failing `open`/`xdg-open` launchers so a lapsed sign-in cannot open a browser, child process group killed on exit or timeout, stderr only matched for the signed-out phrases and never shown. `agy` runs at most once per 15 minutes unless the user presses Refresh; no loop.
- Behaviour fix: the previous CodexBar route drew the Gemini 5-hour lane as 0% used. `agy` marks that bucket `disabled` (the weekly limit is spent, so the 5-hour limit "does not currently apply"). It is now explained in words, not drawn as a bar.
- Untouched buckets (fraction 1) report `reset_time` as now plus the window, which moves on every read (checked: 5 h and 7 d after the call). They show the window length instead of a fake reset.
- Not available: plan tier. `plan_tier` exists only in the interactive [status-line payload](https://antigravity.google/docs/cli/statusline); neither print-mode report has a tier or account, and the ACP server reports no quota ([antigravity-cli#1045](https://github.com/google-antigravity/antigravity-cli/issues/1045), open). The Plan row says so, plus a hedged note that five-hour limits exist and Google lists them for Pro and Ultra only.
- Rejected: reading `agy`'s keychain token or calling `cloudcode-pa.googleapis.com` (third-party OAuth, banned; HarnessDesk made the same call), OMP's `google-antigravity` token (same), the status-line hook (needs an interactive session and edits the user's `settings.json`), Google One (no public API).

## OpenRouter

Shown: credits remaining, used, and added; spend, requests, tokens, and model count for the last 30 completed UTC days; spend and request count per model (top eight plus "Other (N models)"); BYOK spend when present. Live: 14 models, $8.71 over 30 days, $5.35 on the top model.

- Source: [`GET /api/v1/credits`](https://openrouter.ai/docs/api/api-reference/credits/get-credits) and [`GET /api/v1/activity`](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity). `/activity` requires a [Management key](https://openrouter.ai/docs/guides/overview/auth/management-api-keys). Nothing else splits spend by model (`/key` is one key's totals, `/generation` is one request).
- Credential: an OpenRouter key, tried in order, sent only to openrouter.ai: `OPENROUTER_MANAGEMENT_API_KEY`, the key in CodexBar's config (`~/.config/codexbar/config.json`), `OPENROUTER_API_KEY`. Only a 401 or 403 moves to the next key.
- Evidence the env key is regular: `is_management_key: false`, `/credits` 200, `/activity` 403. With only a regular key the row still shows credits and says per-model spend needs a Management key.
- Limits: Activity excludes today, so its total trails the lifetime Used figure (the row says so).
- CodexBar is no longer called for OpenRouter.

## OpenCode Go

Shown: plan (`Go`, renews Dec 7 local); the 5-hour, weekly, and monthly windows as exact used and allowed dollars ($0.00 of $12, $1.91 of $30, $3.39 of $60, so 0%, 6.36%, 5.66%); 30-day API-rate cost ($5.59), requests, and tokens. The CodexBar local estimate had shown 0%, 0%, 0% and a different monthly reset, so it was wrong.

- Source: OpenCode's console API with the Go key as a bearer token: `GET /console/api/go/status` (`product`, `access.meters.{fiveHour,week,month}` with `usedMicroCents` and `limitMicroCents`, `endsAt`), `GET /console/api/usage/summary?range=30d`, and `GET /console/api/billing/status`. The [console API docs](https://opencode.ai/docs/console/api#permissions) describe per-key permissions (Usage: Read, Billing: Read) and HTTP 403 outside them, but list no usage or billing routes, so the routes are undocumented. CodexBar's [OpenCode provider](https://github.com/steipete/CodexBar/blob/main/docs/opencode.md) uses the same three. Fallback: `GET /zen/go/v1/usage` (percent and reset per window, from the open-source console route), then CodexBar's local estimate marked **est.**
- Credential: the Go key OpenCode already stores (`opencode-go` in `~/.local/share/opencode/auth.json`), Pi's `opencode-go` login, or `OPENCODE_API_KEY`. Sent only to opencode.ai.
- Live results 2026-11-10 with the stored Go key: `go/status` 200, `usage/summary` 200, `billing/status` 403 `Forbidden`, `/zen/go/v1/usage` 200.
- Balance: a personal key created in the OpenCode Console (Account > Personal API keys) with Usage: Read and Billing: Read, and no other permission. With it, `billing/status`, `go/status`, `usage/summary`, and `/zen/go/v1/usage` all answered 200 and `/inference/go/v1/models` answered 403. `billing/status` returned `billingMode: prepaid`, `mode: pay-as-you-go`, `balanceMicroCents: "0"`, `availableMicroCents: "0"`, so the balance is $0.00. The real fetcher run against that key shows `Remaining: $0.00` and no key in its output. A zero balance renders as $0.00, not as a missing field.
- Unused 5-hour window: the console reports `resetsAt: null`, and none is invented. (The older `/zen` route reports "now plus 5 hours" for an idle rolling window, which the fallback path suppresses.)
- A missing subscription (403 `EntitlementError` from `/zen`) is reported as such.

## Credit balances, every provider

| Provider | Balance | Plan tier | Evidence |
| --- | --- | --- | --- |
| Codex | Shown (credits remaining, reset credits). | Shown. | Unchanged, via CodexBar and the Codex login. |
| Claude | Shown: prepaid credit balance (`$0.00`) and extra usage (off, out of credits, $0.00 of $100.00). | Shown: Ultra, Max 20x, active. | Live: `/api/oauth/profile`, `/prepaid/credits`, `/usage` all 200 with the OMP token. Anthropic's documented [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) needs an Admin key and has neither, so these undocumented endpoints are the only source; they can change without notice. |
| Antigravity | Shown: `remaining_credits` from `/credits`. | Not available. | See above. |
| OpenRouter | Shown: remaining, used, added. | Not applicable. | `/credits`. |
| OpenCode Go | Shown: pay-as-you-go balance ($0.00 live), needs a key with Billing: Read. | Shown: Go. | See above. |
| Baseten | Not available. | Not applicable. | The official OpenAPI spec (`https://api.baseten.co/v1/spec`, 200 paths) has no balance field. Billing paths are `usage_summary`, `model_apis`, `tool_call_usage`; `/v1/organizations/me` returns only `org_id`, `name`, `created_at`, `aws_assume_role`. [Billing docs](https://docs.baseten.co/organization/billing#credits): "Check your current credit balance and remaining amount on the billing dashboard." The earlier note was right. |

Each unavailable field is listed on one line per card, "Not available from the API: <field>" (Plan, Credit balance, and so on), with the evidence under Details. See `reports/2026-11-10-usage-ui-redesign.md` for the current layout.

## Files changed

- `server/usage.ts`: `agy` source, OpenRouter source, OpenCode Go console-API source with fallbacks, Claude account source (profile, prepaid credits, extra usage; held 10 minutes; one forced token refresh only after a 401; runs after CodexBar's Claude call so refreshes cannot race), shared `fetchProviderJson`, `readApi`, `withHold`, and `HttpStatusError`, unavailable rows for Baseten, OMP path reduced to Claude, `force` passed to providers so Refresh bypasses the holds.
- `shared/usage.ts`: optional `estimated` on windows; optional `unavailable` on rows; optional per-group `note`. Old snapshots still load.
- `client/main.tsx`: **est.** marker, unavailable row style, per-group notes.
- `README.md`: sources, credentials, per-provider evidence table, Antigravity terms section, new environment variables, refresh behaviour.
- `tests/provider-sources.test.cjs` and `tests/server-loader.cjs` (new, synthetic fixtures only); `tests/usage-errors.test.cjs` (old Antigravity and OpenCode Go normalize tests removed, Baseten balance assertions added).

## Validation

- `npm run typecheck`: clean.
- `npm test`: 40 passed, 0 failed. New tests cover the `agy` parser (disabled and untouched buckets, credits, plan row), the `agy` invocation (arguments, environment guards, hold, forced refresh, signed-out and failure messages never echo output, missing binary), the OpenRouter per-model aggregation and key order (no non-OpenRouter credential sent, 403 falls through, 503 does not), OpenCode Go (console plan and limits and spend, the live-shaped balance response, a zero balance shown as $0.00, percent-only fallback, missing subscription, estimate fallback), and Claude (plan, prepaid, extra usage, only api.anthropic.com sees the token with the beta header, one forced refresh after a 401, partial failure notes, hold and Refresh, no OMP login).
- Live API checks 2026-11-10: OpenRouter `/key`, `/credits`, `/activity`; OpenCode `/zen/go/v1/usage`, `/console/api/go/status`, `/usage/summary`, `/billing/status`, `/orgs`; Claude `/api/oauth/profile`, `/prepaid/credits`, `/usage`; `agy --print /usage` and `/credits`; Baseten OpenAPI spec. Then the real fetchers for Claude and OpenCode Go end to end. No credential was printed.
- Live snapshot (`~/.local/state/paseo-provider-usage/snapshot.json`, mode 0600): Claude has Plan, Prepaid credits, and Extra usage groups and plan `Ultra`; OpenCode Go has plan `Go`, dollar limits, 30-day spend, and, since the daemon restart, `Pay-as-you-go balance: Remaining $0.00` with no note. A scan for token-like strings found none.
- UI in the real Paseo client, first design (since replaced by the card layout), light theme, desktop width and a narrow zoomed width: rows, notes, italic unavailable rows, per-model list, and the 100% red Gemini weekly row (red and near-full) rendered and wrapped correctly.
- Not verified: a dark theme. Background mouse clicks crashed the Paseo renderer (EXC_BREAKPOINT in Electron, three times; reports in `~/Library/Logs/DiagnosticReports`, same signature as 2026-11-04). Scrolling, menu commands, and keyboard did not. I recovered each time with View > Reload and stopped clicking, so the theme setting was never changed. The new code takes every color from `theme.colors` and adds no hex values.

## OpenCode key setup

- The pay-as-you-go balance needs a personal key with Usage: Read and Billing: Read. Create it in the OpenCode Console under Account > Personal API keys, grant nothing else, and set it as `OPENCODE_API_KEY` in the daemon's environment. The plugin reads the variable only at daemon start.
- The key value is never printed, logged, put in a command argument, or written to the snapshot.
- Live check after the daemon restarted with the variable set: the OpenCode Go card shows Pay-as-you-go balance, Remaining $0.00, and the "Not available from the API" line for the balance is gone.
