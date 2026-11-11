# Usage screen redesign

Date: 2026-11-10.

## Outcome

Each provider is now a card. The header has the name, a plan tag, the account and source, and one headline figure. The body uses the same sections on every card: Limits, Plan, Balance and credits, Spend and activity. Per-model lists, counts, and notes are behind one Details toggle per card that works from the keyboard. Fields an API does not expose appear on a single line per card. On the live data, the default OpenRouter card dropped from about 22 lines to about 8. The six provider headlines can be scanned without reading any rows.

`npm run typecheck` passes, and `npm test` passes 41 of 41. I checked the screen in the real Paseo desktop client in the light theme, at desktop width and in the host's compact layout. I could not check the dark theme (see Unverified).

## What changed and why

### Shared contract (`shared/usage.ts`)

These additions are all optional or defaulted, so snapshots written before them still parse. I saw that live: the old snapshot on disk rendered (every group under Details) until the first refresh replaced it.

| Field | Where | Why |
| --- | --- | --- |
| `kind` | spend group, one of `limits`, `plan`, `balance`, `spend`, `breakdown`, `detail`; defaults to `detail` | The client places each group by what it means and does not parse titles. The first row of a `balance` or `spend` group is its key figure. |
| `headline` | spend, `{ label, value }`, optional | The at-a-glance figure for a provider without usage windows (OpenRouter credit left, Baseten 30-day spend). The server builds it from the provider's own amounts. |
| `share` | row, 0 to 100, optional | Per-model share of the group total, computed on the server from the provider's amounts and drawn from zero. The client never parses money out of strings. |
| `detail` | row, optional | Muted secondary text beside a value, such as `1.4K req`. |
| `amount` | window, optional | The provider's own dollars behind a limit, such as `$1.91 of $30.00`, shown on the limit row itself. |

### Server metadata (`server/usage.ts`)

These are presentation-only changes in the functions that build the groups. Fetching, credentials, caching, hold windows, and network calls are unchanged.

- Every group now sets `kind`: CodexBar credits (`readProviderSpend`), Claude account groups, Antigravity, OpenRouter, OpenCode Go (including the estimate fallback), and Baseten.
- Antigravity: a switched-off lane is now its own `limits` group (`Gemini 5-hour`, value `Not in effect`, with agy's explanation as the group note). Before, it was a footnote joined into `spend.note`. It now sits with the limits.
- OpenRouter: per-model rows carry `value` (`$5.39`), `detail` (`1.4K req`), and `share` measured against the whole 30-day spend. The `Other (N models)` row now also has its request count and share. Requests, tokens, and the model count moved to a `detail` group named `Activity, last 30 completed UTC days`. The headline is the remaining credit.
- OpenCode Go: the `Used of limit` group is gone because its dollars now sit on each window as `amount`, so nothing is lost. The 30-day group keeps the API-rate cost, and the request and token counts moved to a `detail` group.
- Baseten: per-model rows carry `share`. When there are several categories, the total (`Total before credits`) now comes first, so the key figure is the total. The headline is the 30-day spend. The balance evidence moved from `spend.note` to the `Credit balance` group note, so it travels with the field it explains.
- `formatUsd` now uses `Intl` currency formatting, so every dollar figure groups thousands the same way as Claude's amounts (`$1,300.00`, not `$1300.00`).

### Client

- `client/parts.tsx` (new): the theme-derived styles (`makeStyles(theme, compact)`), share bar, tag (`Chip`), card surface, and divider. Every color comes from `theme.colors`, and tints are opacity layers. A grep for hex, `rgb(`, and `hsl(` in `client/` finds nothing.
- `client/provider-card.tsx` (new): one provider card.
  - Header: name, plan tag (with the accessible name `Plan: …`), account and source, and the headline. With windows, the headline is the most-used limit, its reset, and a `Near limit` (90% or more) or `Limit reached` (100%) tag, so color is not the only signal. Otherwise it is the server's `headline`.
  - Limits: bars 6 px high, measured from zero, red and near-full when critical. Reset text and the provider's dollar amount are on the row. An `Estimate` tag replaces the old `est.` suffix. `limits` groups without a bar show their note right under the row.
  - Plan, Balance and credits, Spend and activity: label and value rows with right-aligned tabular figures. The first row of a balance or spend group is the key figure (14 px semibold). A plan row that only repeats the plan tag is left out. On desktop the panels sit two per row, and in compact they stack.
  - `Not available from the API: …`: one muted line listing every unavailable field, named by its group (`Plan`, `Credit balance`, `Pay-as-you-go balance`). The evidence for each is under Details, prefixed with the field's name.
  - Details: a `button` with `accessibilityState.expanded`, `aria-expanded`, and an accessible name `Show/Hide <provider> details`. It holds per-model share bars, count groups, and notes. A short hint shows what is inside (`Spend by model · Activity · 1 note`).
- `client/main.tsx`: the page header and Plans list are unchanged in behavior. Agent activity is now a card with the same surface. Its header shows the scope (`All models` or the selected model) and the range control, and a `Show all models` button replaces the inline link. The model list has a `Tokens by model` heading, with cost muted beside tokens. `formatCost` groups thousands and shows `n/a` for an unknown price.
- `testID="provider-usage-surface"` is unchanged.

### Tests

- Updated the five tests that pinned the old group shapes.
- New assertions, all with synthetic fixtures, cover metadata a user would see if it were wrong:
  - OpenRouter and Baseten per-model shares are measured against the total and add up to 100%.
  - The OpenRouter and Baseten headline figures.
  - The Baseten total leads when there are several categories, and thousands are grouped.
  - The Antigravity switched-off lane is a `limits` group with agy's explanation.
  - OpenCode Go dollars sit on the windows.
  - The `kind` of the groups that decide placement.

## Each card, before and after (live data, light theme)

| Provider | Before | After |
| --- | --- | --- |
| Claude | Name, then a right-aligned meta line. Three bars. Then three muted-title groups: Plan (3 rows, tier repeated), Prepaid credits, and Extra usage (3 rows). A footnote. | Header with an `Ultra` tag and the headline `57% used, Session, resets Thu 11:59 AM`. Limits (3 bars). Plan (rate limit tier, subscription) beside Balance and credits (prepaid `$0.00`). Spend and activity (extra usage status, used, limit). Details holds the source note. |
| Codex | Meta line, one bar, Credits and Rate limit resets as muted-title groups. | Tag `prolite` and the headline `56% used, Weekly`. One bar. Balance and credits with credits and reset credits. No Details toggle, because there is nothing secondary. |
| Antigravity | Three bars. An italic `Not available from the API` Plan row with a footnote. AI credits with a footnote. The switched-off lane explained in a footnote at the bottom. | The headline is a red `100% used` with a `Limit reached` tag. Gemini weekly is a red, full bar. The `Gemini 5-hour: Not in effect` row with agy's explanation sits directly under the bars. AI credits under Balance and credits. `Not available from the API: Plan`. The plan evidence and the credits rule are under Details. |
| OpenRouter | No bars. Credits (3 rows), a 4-row activity group, 9 per-model rows as `$5.39 · 1.4K req` text, and a footnote. | Headline `$3.42 Credits remaining`. Balance and credits (remaining, used, added) beside Spend (`$8.75`). Details: 8 models plus `Other (6 models)` as share bars of the $8.75 total, with request counts muted, then the activity counts and the Activity API note. |
| OpenCode Go | Three bars, then a separate `Used of limit` group that repeated them in dollars. A 5-row 30-day group. An italic unavailable balance row with a long hint. Two footnotes. | Tag `Go` and the headline `6% used, Weekly`. Each bar row shows its dollars (`$1.91 of $30.00   6%`). Plan (renews) beside Spend (API-rate cost `$5.59`). `Not available from the API: Pay-as-you-go balance`. The counts, the billing-permission hint, and the source note are under Details. |
| Baseten | No bars. Last 30 days (3 rows), Model APIs by model, Tokens (3 rows), an italic Credit balance row, and a footnote. | Headline `$10.22 Spent, last 30 days`. Spend and activity (Model APIs, credits applied, due). `Not available from the API: Credit balance`. Details: the per-model share bar, tokens, and the balance evidence. |
| Agent activity | Section title with the range tabs, then stats, chart, and model list on the page background. | The same content inside a card that matches the provider cards. |

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passes (run after every source change, last after the final client edit). |
| `npm test` | 41 of 41 pass (the 5 updated tests and 1 new test included). |
| `paseo plugin reload provider-usage` | Ran at 00:25, 00:32, and 00:47 UTC (the last one applied the final client edit). Plugin `running`, no errors in `paseo plugin logs`. The screen rendered after each reload. |
| Desktop, light theme | Paseo window 1200 × 800 at 100% zoom, content at its 640 px maximum. All six cards and Agent activity were inspected on live data after the refresh wrote `kind` into the snapshot. |
| Compact, light theme | View › Zoom In to Electron zoom level 5 (about 480 CSS px wide). The host switched to its compact layout (back arrow, no sidebar, 12 px page padding). Cards, panels, bars, notes, and activity were inspected. Restored with View › Actual Size. |
| Narrow desktop widths | About 400 CSS px and about 250 CSS px of content, still in the desktop layout. Reset text and amounts wrap instead of truncating, so every row keeps its timing. |
| Keyboard | From the sidebar, Tab reached Close, Refresh, then each Details toggle in card order (a focus ring was visible). Enter expanded and collapsed it. The accessibility tree showed `AXButton (Show OpenRouter details)`, which changed to `Hide OpenRouter details`. The same worked in compact (Tab ×4, then Enter on Antigravity). |
| Old snapshot | The pre-change `snapshot.json` (no `kind`) parsed and rendered with every group under Details until the background refresh replaced it. |
| Bug found and fixed | In compact, the stacked panels shrank to their content width, because React Native's `alignContent: flex-start` applied to a wrapping column. Compact now stacks the panels without wrapping, and I re-checked it live. |

I drove the client only with the keyboard, menu commands (File › New Window, View › Zoom In, Actual Size, Reload), and accessibility-targeted scrolling. I made no mouse clicks, and the renderer did not crash.

### Unverified

- Dark theme. Switching it needs a settings change, which I was told not to make. Every color is a theme token, and tints are opacity layers over theme colors, but I did not see it rendered.
- The `Estimate` tag and the `Near limit` (90 to 99%) tag. No live provider is in either state today. Both are covered by code review only.
- iOS, Android, and the web client. I checked only the macOS desktop client.
- Full screen-reader output. I checked the accessible names of the toggles in the accessibility tree, but I did not run VoiceOver.

## For the owner

- Paseo had no open window, so I opened one with File › New Window. It is still open.
- Each `paseo plugin reload` clears the plugin's in-memory hold, so the first refresh after it runs `agy` again. My two reloads were 7 minutes apart, so `agy` ran twice within 15 minutes, with no prompts and no loop. I applied the final source edit (a React key, no visual change) with one more reload, at least 15 minutes after the last one.
- `docs/screenshot.png` shows the old design. It was not replaced.
- `reports/2026-11-10-usage-plugin-extend.md` still says unavailable fields render as italic rows under their own headings. That was true before this change. I left that report as it was.
