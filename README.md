# Paseo plan usage

A [Paseo](https://paseo.sh) plugin. It shows how much of your Claude, Codex, Antigravity, OpenRouter, OpenCode Go, and Baseten plans you have used. It adds one **Usage** item to the sidebar. No extra window opens.

![The Usage screen at desktop width: two cards per row for Claude, Codex, Antigravity, OpenRouter, OpenCode Go, and Baseten, with limits, plan, balances, and spend, above the agent activity card. Account names are redacted.](docs/screenshot.png)

You see limits, reset times, credit balances, and spend on one screen. You can reorder the cards, fold them, switch to a list, and search. It works on desktop, tablet, and phone.

Working on this code as an AI agent? Start at [For AI agents](#for-ai-agents).

## Quick facts

| | |
| --- | --- |
| Plugin id | `provider-usage` |
| Needs | Paseo 0.15.0 or newer |
| Providers | `claude`, `codex`, `antigravity`, `openrouter`, `opencodego`, `baseten` |
| Open it | Click **Usage** in the sidebar. Or press `Cmd+K` (`Ctrl+K`) and run **Open plan usage**. |
| Install | `paseo plugin install git:nerveband/paseo-provider-usage` |
| Check the code | `npm run typecheck && npm test` |
| Apply a change | `paseo plugin reload provider-usage` |
| What it does | It only reads usage. It never changes an account and never creates a key. |
| License | MIT |

## What you see

Each provider has one card.

- The header shows the name, the plan tag, the account, and where the numbers came from.
- The header also shows one headline figure: the most-used limit, the credit left, or the 30-day spend.
- Each limit row shows its name, when it resets, how much you used, and a bar.
- Two levels, and they look different. At 90% or more the bar and the tag turn yellow and the card says **Near limit**. At 100% the tag becomes a filled red pill, the figure turns heavy red, and the card says **Limit reached**.
- Plan facts, balances, and spend sit under the same three headings on every card.
- If an API has no field for something, the card says **Not available from the API**. It never shows a made-up number.
- A number the plugin had to estimate has an **Estimate** tag.
- Per-model lists, counts, and notes are under **Details**. You can open it with the keyboard.

What each provider shows:

- **Claude.** Session and weekly limits. Plan tier. Prepaid credit balance. Extra usage status and spend.
- **Codex.** The weekly limit. Credits left. Rate-limit reset credits.
- **Antigravity.** The 5-hour and weekly quota for each model group. Your AI credits left. The plan tier is not available, because Google's `agy` command shows it only on its interactive screen. Sometimes Google switches off the 5-hour limit because the weekly limit is used up. The card then says so in words. It does not draw a 0% bar. A group you have not used yet shows its window length, because Google reports its reset as "now plus the window".
- **OpenRouter.** Credits left, used, and added. Spend for the last 30 full UTC days. Under **Details**, spend per model: the top eight, then the rest. Per-model spend needs an OpenRouter Management key.
- **OpenCode Go.** Your plan. The 5-hour, weekly, and monthly limits, each with the dollars used and allowed. The 30-day spend. The pay-as-you-go balance, if your key can read billing. If OpenCode cannot be reached, the card shows an **Estimate** from CodexBar.
- **Baseten.** The last 30 days of billing: spend by product, credits applied, the amount due, spend by model, and tokens. Baseten has no limits and no balance in its API, so those rows say **Not available from the API**.
- **Agent activity.** Tokens, estimated cost, and sessions for 24 hours, 7, 14, or 30 days, or all time. Tap a bar to see one day or hour. Tap a model to show only that model.

Some internal lanes, like `gpt-reserve`, are hidden. They copy a real limit.

## Phone, tablet, and desktop

The layout follows the width of the Usage pane, not the window.

- Under 720 px: one column, up to 640 px wide. The headline figure sits under the provider name.
- From 720 px: two columns. The two cards in a row share one height. The page grows up to 1160 px. Agent activity spans both columns.
- Every button, tab, and toggle is at least 44 points tall. The chart has previous and next buttons, because one day's bar can be too thin to tap.
- On iOS and Android you can pull down to refresh. It works like **Refresh**.

<table>
<tr>
<td valign="top"><img src="docs/screenshot-phone.png" width="260" alt="The Usage screen on a phone: a toolbar with search, a Grid and List switch, and filter chips, then one card per provider in a single column. Account names are redacted."></td>
<td valign="top"><img src="docs/screenshot-tablet.png" width="520" alt="The Usage screen on a tablet in landscape: the toolbar, then two equal-height cards per row, then the agent activity card across both columns. Account names are redacted."></td>
</tr>
<tr>
<td align="center">Phone, one column</td>
<td align="center">Tablet, two columns</td>
</tr>
</table>

## Make it yours

![The Usage screen in List view: one row per provider, with the search field, the Grid and List switch, and the filter chips above it. Account names are redacted.](docs/screenshot-list.png)

- **Reorder.** Drag a card by its grip (six dots, top right) and drop it where the outline shows. The page scrolls for you near the top or bottom edge. On a phone or tablet, drag the grip with your finger. Swiping anywhere else still scrolls.
- **Reorder without dragging.** Press the grip, or focus it and press Enter. You get **Move up** and **Move down** buttons. Screen readers get the same two actions and hear each move, such as "Claude moved to position 3 of 6". Agent activity always stays last.
- **Fold a card.** Click or tap anywhere on a card's header to fold it down to its name, plan tag, and headline. Do it again to open it. **Collapse all** and **Expand all** are in the **⋯** menu.
- **Grid or List.** The **Grid** and **List** switch is next to the search field. List shows one compact row per provider. Press a row to open the full card in place. Open rows are not remembered.
- **Search.** The search field matches names, plan tags, sources, and the labels and values on each card, including **Details**. Try "balance", "weekly", "$0", or a model name. It also narrows the Agent activity model list. On the web and desktop apps, press `/` to jump to it.
- **Filters.** The chips are **Near limit** (a limit at 90% or more), **Has balance**, and **Needs attention** (an error, an estimate, or a field the API does not give). Each chip shows how many providers it would show. "Showing 3 of 6" tells you how much is hidden. It also says when a hidden provider failed to load. **Clear** brings everything back.
- **Saved.** The order, the folded cards, and Grid or List are saved by the Paseo daemon (its background service). Every app on that daemon picks up a change right away. The file is `~/.paseo/plugin-settings/provider-usage/layout.json`, readable only by you. It holds card names and the view. It never holds a token, an account, or a number. If a save fails, the screen keeps your change and shows **Layout not saved** next to the update time. Search text and the chosen chip are not saved.
- **Reset.** **Reset layout** in the **⋯** menu puts everything back: default order, all cards open, Grid view. Deleting the file does the same.

## Install and set up

```bash
paseo plugin install git:nerveband/paseo-provider-usage
paseo plugin ls
```

Update later:

```bash
paseo plugin update provider-usage --check
paseo plugin update provider-usage
```

Then click **Usage** in the sidebar.

What you need:

- Paseo 0.15.0 or newer.
- The CodexBar CLI (`codexbar`) for the Claude and Codex limits. Put it on your `PATH` or in `~/.local/bin`, or set `CODEXBAR_BIN`. Get it from [CodexBar releases](https://github.com/steipete/CodexBar/releases) (macOS and Linux).
- Optional: OMP signed in to `anthropic`, for the Claude plan, prepaid balance, and extra usage.
- Optional: the [Antigravity CLI](https://antigravity.google/download) (`agy`), signed in once, for the Antigravity card.
- Optional: an OpenRouter Management key, an OpenCode key, and a Baseten key. Without one, only that card shows a setup message. The other cards still load.

### Environment variables

Set these for the Paseo daemon. The daemon reads them only when it starts.

| Variable | What it does |
| --- | --- |
| `CODEXBAR_BIN` | Full path to CodexBar. If unset, the plugin looks on your `PATH`, then in `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`. |
| `ANTIGRAVITY_CLI_PATH` | Full path to `agy`. If set, it is the only place the plugin looks. If unset, the plugin searches the same folders as CodexBar. |
| `OPENROUTER_MANAGEMENT_API_KEY`, `OPENROUTER_API_KEY` | OpenRouter keys. They are tried before and after the key CodexBar stores. |
| `OPENCODE_API_KEY` | OpenCode key. If unset, the plugin uses the login that OpenCode or Pi already saved. |
| `BASETEN_API_KEY` | Baseten key. If unset, the plugin uses the key saved by your Pi login. |
| `XDG_STATE_HOME` | Where the saved numbers go. The default is `~/.local/state`. |

### Add an OpenRouter key

Per-model spend comes from `GET /api/v1/activity`. OpenRouter allows that only with a [Management key](https://openrouter.ai/docs/guides/overview/auth/management-api-keys).

The plugin tries these keys in order and sends each one only to openrouter.ai:

1. `OPENROUTER_MANAGEMENT_API_KEY`
2. The key CodexBar stored for its `openrouter` provider
3. `OPENROUTER_API_KEY`

A regular key still shows credits. The card then says that per-model spend needs a Management key. A key from any other provider is never read.

```bash
codexbar config set-api-key --provider openrouter --stdin   # paste a Management key, then press Ctrl-D
```

The activity data covers the last 30 full UTC days and leaves out today. Its total can be a little lower than the lifetime **Used** figure.

### Add an OpenCode key

The plugin sends your OpenCode key to OpenCode's console API and shows what comes back. You see the plan, the dollars used and allowed in each window, and the 30-day cost and tokens. Each percentage is those two dollar numbers divided, so it is exact.

The plugin looks for the key in this order: `OPENCODE_API_KEY`, then OpenCode's own login (`opencode-go` in its `auth.json`), then Pi's login.

Those console routes are not in OpenCode's public docs, so they could change. If they fail, the older `opencode.ai/zen/go/v1/usage` route gives percentages. If that fails too, the card shows CodexBar's local estimate with an **Estimate** tag. When this was added, that estimate said 0% weekly and 0% monthly. OpenCode said 6% and 6%.

To show the pay-as-you-go balance:

1. In the OpenCode Console, open **Account > Personal API keys** and create a key.
2. Set **Usage: Read** and **Billing: Read**. Set every other resource, including Models, to **None**.
3. Set `OPENCODE_API_KEY` to that key for the Paseo daemon, then restart the daemon.

This one key reads the plan, the limits, the 30-day spend, and the balance. It cannot call models. The plugin never creates keys. Console keys expire (90 days by default). When one expires, the card falls back to the older route and then to the estimate, so rotate the key before its date.

### Add a Baseten key

1. Create a key at [app.baseten.co/settings/api-keys](https://app.baseten.co/settings/api-keys).
2. Either sign in to Baseten from Pi on the same machine, or set `BASETEN_API_KEY` for the daemon.

The key needs access to workspace billing. A key from a non-admin account may show lower totals. The Baseten billing API covers up to 31 days per request, so the card shows the last 30 days. Credits applied and the amount due come from that window. Baseten has no field for the credit balance, so the card says it is not available. It does not guess.

## Where the numbers come from

Codex limits and Claude's session and weekly limits come from [CodexBar](https://github.com/steipete/CodexBar). It reuses logins you already have. Everything else is read straight from the provider, with credentials that already exist on this machine.

| Provider | Source | Credential |
| --- | --- | --- |
| Codex | CodexBar. | The Codex CLI login. |
| Claude | CodexBar for the limits. For plan tier, prepaid balance, and extra usage: `GET api.anthropic.com/api/oauth/profile`, `/api/oauth/organizations/{org}/prepaid/credits`, and `/api/oauth/usage`. Claude Code uses these routes too. They are not publicly documented, so they can change. | The OMP `anthropic` login. It is sent only to api.anthropic.com. |
| Antigravity | Google's `agy` CLI in print mode: [`agy --print /usage`](https://antigravity.google/docs/cli/commands/usage) and [`agy --print /credits`](https://antigravity.google/docs/cli/commands/credits). Google documents this for [headless mode](https://antigravity.google/docs/cli/headless). | `agy`'s own sign-in. The plugin never sees a Google token. |
| OpenRouter | [`GET /api/v1/credits`](https://openrouter.ai/docs/api/api-reference/credits/get-credits) and [`GET /api/v1/activity`](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity). | An OpenRouter Management key. |
| OpenCode Go | `GET opencode.ai/console/api/go/status`, `/usage/summary?range=30d`, and `/billing/status` ([key permissions](https://opencode.ai/docs/console/api#permissions)). Fallback: `GET opencode.ai/zen/go/v1/usage`. | The OpenCode key described above. |
| Baseten | The [Baseten billing API](https://docs.baseten.co/organization/billing). | `BASETEN_API_KEY` or the key from your Pi login. |

No app window opens. You do not need the Antigravity app or an `agy` session running.

### What each provider can and cannot report

Checked against each provider's docs and API on 2026-11-10. "Not available" means the API has no field for it. The card says so.

| Provider | Plan tier | Credit balance | Evidence |
| --- | --- | --- | --- |
| Codex | Shown. | Shown: credits left. | Reported by the Codex login that CodexBar uses. |
| Claude | Shown: plan name and rate-limit tier. | Shown: prepaid balance and extra-usage spend. | Anthropic's documented [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) needs an Admin key and reports API spend, so it has neither. The values come from the OAuth routes above. |
| Antigravity | Not available. | Shown: AI credits left. | `plan_tier` exists only in agy's interactive [status line](https://antigravity.google/docs/cli/statusline). `/credits` returns `remaining_credits`. The ACP server reports no quota ([antigravity-cli#1045](https://github.com/google-antigravity/antigravity-cli/issues/1045)). |
| OpenRouter | Not applicable. | Shown: left, used, and added. | `/api/v1/credits` returns `total_credits` and `total_usage`. |
| OpenCode Go | Shown. | Shown, with a key that has Billing: Read. | The key OpenCode stores for inference reads status and usage, but gets HTTP 403 on `/console/api/billing/status`. A personal key with only Usage: Read and Billing: Read reads all four routes. |
| Baseten | Not applicable. | Not available. | The [OpenAPI spec](https://api.baseten.co/v1/spec) has no balance field. The [billing docs](https://docs.baseten.co/organization/billing#credits) say to read the balance on the dashboard. |

### Antigravity and Google's terms

Antigravity's [terms](https://antigravity.google/terms) (clause 6) say that using a third-party tool to reach the service with Antigravity OAuth is a breach. The Google AI forum has reports of suspended accounts. So the plugin follows these rules:

- It never reads, copies, or forwards a Google token.
- It never calls Google's quota servers itself.
- It does not use OMP's `google-antigravity` login.
- It runs only `agy`, the way Google documents for scripts: two print-mode reports that send no model prompt.
- It runs `agy` at most once every 15 minutes, unless you press **Refresh**. It never runs it in a loop.
- It runs `agy` with auto-update off, no log file, an empty working directory, and a launcher that refuses to open a browser.
- If `agy` is missing or signed out, the card says so and does nothing else.

## How refreshing works

The screen opens at once with the last numbers it saved. It then loads new ones in the background. You see `Updating…` next to the time. You see a spinner only the very first time, before anything is saved.

The saved numbers are in `$XDG_STATE_HOME/paseo-provider-usage/snapshot.json` (usually `~/.local/state/paseo-provider-usage/`). Only your user can read it. It holds usage numbers, reset times, and the account name. It never holds a token.

Providers limit how often you can ask, so the plugin asks rarely:

- Numbers under 60 seconds old are reused.
- Older numbers show right away while new ones load in the background.
- If several requests arrive together, they share one fetch.
- The screen checks every 5 minutes. It checks every 2 seconds only while a background fetch runs.
- **Refresh** (or pulling down on iOS and Android) skips the saved numbers and waits for new ones.
- `agy` runs at most once every 15 minutes. The last answer is saved with the numbers, so a plugin reload or a Paseo restart inside that time does not run it again. Only **Refresh** runs it sooner.
- Claude's account details (plan, prepaid balance, extra usage) load at most once every 10 minutes, unless you press **Refresh**.

The plugin reads Claude's login token from OMP first. It asks for a new token only if Claude turns the saved one down. A new token cancels the old one.

## How agent activity loads

The plugin reads your local agent history files, up to eight at a time. It remembers each file it has read. When a log grows, it reads only the new lines. If a log was cut short or replaced, it reads that file again from the start. This does not change the usage limits above.

## Security

- The plugin's server code runs next to your Paseo daemon, with no sandbox.
- Tokens go to CodexBar through a private temporary file that only your user can read. The file is deleted after each fetch.
- Each key goes only to its own provider: Baseten to `api.baseten.co`, OpenRouter to `openrouter.ai`, OpenCode to `opencode.ai`, Claude to `api.anthropic.com`.
- Error messages show the HTTP status, never the response body. A key cannot reach the screen or the saved file.
- No Google token is ever read. `agy` signs in by itself. Its output is parsed for numbers only. Its error output is checked for the signed-out phrases and then thrown away.
- Tokens are never logged, printed, or saved in this repository.
- If one provider fails, only its card shows an error. The others still load.
- Raw CLI error output is replaced with a safe message before it reaches the screen or the saved file.
- Two development dependencies use local security patches. See [vendor/README.md](vendor/README.md).

## For AI agents

Read [AGENTS.md](AGENTS.md) first. It is the policy for this repo. This section is the map.

### Rules

1. Never log, print, echo, or commit a token, cookie, or key. This includes error paths, test data, screenshots, and reports.
2. Never restart the Paseo daemon. It stops running agents. Apply changes with `paseo plugin reload provider-usage`.
3. Run `npm run typecheck` before any install or reload. A plugin that fails to typecheck will not load.
4. Do not add polling, retry loops, or fetches that run on mount. Keep the rules in [How refreshing works](#how-refreshing-works).
5. Never make up a number. If a value is missing, leave the row out or set `unavailable: true`.
6. Take every color from `theme.colors`. Do not write hex, `rgb()`, or `hsl()` values.
7. React code goes in `client/`. Node and file code goes in `server/`. Types and pure logic go in `shared/`. Never import a `*.server` module from client code.
8. Give every control an accessible name. Never use color as the only signal.
9. Do not commit, push, or publish unless the owner asks.
10. Put no real email, workspace path, or client name in a screenshot, test, or report.

### Commands

| Goal | Command |
| --- | --- |
| Install dependencies | `npm ci` (keep the `vendor/` folder, the lockfile needs it) |
| Type check | `npm run typecheck` |
| Run tests | `npm test` (Node's test runner, `tests/*.test.cjs`) |
| Audit dependencies | `npm audit` |
| Install this checkout (first time) | `paseo plugin install "$PWD"` |
| Apply a change | `paseo plugin reload provider-usage` |
| Read plugin logs | `paseo plugin logs provider-usage` |
| List plugins | `paseo plugin ls` |

### Files

| File | What it does |
| --- | --- |
| [paseo-plugin.json](paseo-plugin.json) | Plugin id `provider-usage` and the Paseo version it needs. |
| [index.server.ts](index.server.ts) | Registers the two RPC handlers and the layout settings. |
| [index.client.tsx](index.client.tsx) | Adds the screen (`main`), the sidebar item, and the **Open plan usage** command. |
| [shared/usage.ts](shared/usage.ts) | Zod schemas, the two RPC definitions, and the layout settings definition. |
| [shared/layout.ts](shared/layout.ts) | `PROVIDER_IDS`, layout preferences, reorder, search, filters. No React or Node code. |
| [server/usage.ts](server/usage.ts) | Every provider fetcher, the cache, the snapshot file, and the activity totals. |
| [client/main.tsx](client/main.tsx) | The Usage screen: breakpoints, grid and list, folding, reordering, filtering, refreshing. |
| [client/toolbar.tsx](client/toolbar.tsx) | Search field, Grid and List switch, layout menu, filter chips, empty state. |
| [client/reorder.tsx](client/reorder.tsx) | Drag to reorder, auto-scroll, the grip, and the Move buttons. |
| [client/list-row.tsx](client/list-row.tsx) | One provider as a row in List view. |
| [client/use-layout.ts](client/use-layout.ts) | Loads and saves the layout through the daemon's settings store. |
| [client/provider-card.tsx](client/provider-card.tsx) | One provider's card. |
| [client/activity-card.tsx](client/activity-card.tsx) | The agent activity card: range tabs, chart, models. |
| [client/parts.tsx](client/parts.tsx) | Type scale, spacing, bars, tags, and shared styles, all from the theme. |
| [tests/](tests/) | Tests with fake data only. `server-loader.cjs` loads the server code for them. |
| [reports/](reports/) | Dated notes on past changes and the evidence behind them. |
| [vendor/](vendor/) | Local security patches for two development dependencies. |

### Names to know

| Thing | Name |
| --- | --- |
| Provider ids | `claude`, `codex`, `antigravity`, `openrouter`, `opencodego`, `baseten` |
| RPC: usage snapshot | `provider-usage.get` with `{ force?: boolean }` returns `{ fetchedAt, providers, stale }` |
| RPC: agent activity | `provider-usage.analytics` |
| Settings | `layout`, scope `host`, version 1: `{ order, collapsed, view }` |
| One provider | `ProviderUsage`: `id`, `name`, `source`, `account`, `plan`, `updatedAt`, `windows`, `error`, `spend` |
| One limit | `windows[]`: `usedPercent` (0 to 100), `resetsAt` or `resetDescription` or `windowMinutes`, optional `estimated` and `amount` |
| Balances and spend | `spend.groups[]` with `kind`: `limits`, `plan`, `balance`, `spend`, `breakdown`, or `detail`. Rows can set `unavailable`, `detail`, and `share`. |
| Screen element for screenshots | `testID="provider-usage-surface"` |

### Add a provider

1. Add its id to `PROVIDER_IDS` in `shared/layout.ts`. The cards, the list, search, and filters need no other change.
2. In `server/usage.ts`, write `fetchYourProvider()`. It returns a `ProviderUsage`. Use `fetchProviderJson` or `readApi`. Send the key only to that provider's host. On a failure, report the HTTP status and never the response body.
3. Add one line for it in `fetchProvider` in `server/usage.ts`.
4. Put plan facts, balances, and spend in `spend.groups` with the right `kind`. For a field the API lacks, add a row with `unavailable: true`.
5. Add tests with fake data in `tests/provider-sources.test.cjs`. Cover a good answer, a 401 or 403, and a missing key.
6. Run `npm run typecheck` and `npm test`. Reload the plugin. Look at the card in a real client.

### Change the screen

1. Edit files in `client/`. Keep the type scale and spacing in `client/parts.tsx`.
2. Check the result in a real client, in light and dark mode, at phone (320 to 430 px), tablet (700 to 1100 px), and desktop widths.
3. The daemon's own web client (when `webUi` is on) draws the real plugin in any browser. A headless browser can show true phone and tablet sizes and a dark color scheme. This changes no app setting.
4. Before you take a screenshot, replace every email on the page with "account redacted". Crop to the `provider-usage-surface` element. Do not show the sidebar or workspace names.
5. In the Paseo desktop app, do not click with the mouse from automation. Background clicks have crashed its renderer. Use the keyboard, the menu, and scrolling. View > Reload restarts the page.

### Files the plugin writes

| File | Written by | Holds |
| --- | --- | --- |
| `$XDG_STATE_HOME/paseo-provider-usage/snapshot.json` | The plugin | Usage numbers, reset times, account names, the last Antigravity answer. Mode 0600. Never a token. |
| `~/.paseo/plugin-settings/provider-usage/layout.json` | The Paseo daemon | `order`, `collapsed`, and `view`. Mode 0600. |

### Common problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Plugin is not loaded after a change | `npm run typecheck` fails | Fix the type errors, then reload. |
| A card shows an error | That provider's key or login is missing or expired | Read the card text. Check `paseo plugin logs provider-usage`. Never print the key. |
| OpenCode Go shows **Estimate** | The key is missing, expired, or not set for the daemon | Set `OPENCODE_API_KEY`, then restart the daemon. |
| Antigravity numbers look old | The 15 minute hold on `agy` | Press **Refresh**. |
| Layout does not save | The daemon cannot write its settings folder | Look for **Layout not saved** on the screen. Fix the folder permissions. |
| Claude has no plan or balance | OMP is not signed in to `anthropic` | Sign in. The limits still come from CodexBar. |

## Credits

Claude and Codex data comes from [CodexBar](https://github.com/steipete/CodexBar) by Peter Steinberger. Antigravity comes from Google's [Antigravity CLI](https://antigravity.google/docs/cli/headless). OpenRouter comes from its [API](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity). OpenCode Go comes from OpenCode's usage endpoints. Baseten comes from the [Baseten billing API](https://docs.baseten.co/organization/billing).

## License

[MIT](LICENSE)
