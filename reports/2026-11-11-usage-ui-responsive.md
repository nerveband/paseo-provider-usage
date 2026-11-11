# Usage screen: phone, tablet, and desktop

Date: 2026-11-11.

## Outcome

The layout now follows the measured width of the Usage pane:
- **Narrow panes:** one column below 720 px.
- **Wide panes:** two equal-height cards per row from 720 px, with the content capped at 1160 px.
- **Card headers:** a card narrower than 420 px of content puts its headline under the provider name.

Every control has a real 44 pt touch target, measured in the rendered page. No text is below 12 px, and the type scale has four sizes. Text uses only `foreground` and `foregroundMuted`, so it reads in the dark theme, which I could see this time. Errors, estimates, and missing fields have designed states.

`npm run typecheck` passes, and `npm test` passes 43 of 43. This round changed only client files, the README, and this report. `shared/usage.ts`, `server/usage.ts`, and the tests are unchanged since round 1, apart from the owner's agy-hold change.

## How I could see each size

| Surface | Available | Used for |
| --- | --- | --- |
| The Paseo web client the daemon serves (`webUi` on) in headless Chromium (`agent-browser`) | Yes. | Real renders at phone and tablet viewports (320 to 1440 px, 2× and 3× density). The fresh browser profile followed `prefers-color-scheme`, so I saw the dark theme without changing any app setting. |
| Paseo desktop (Electron), the 1200 × 800 window from round 1 | Yes | Zoom levels 0, 1, 2, 6, and 7 with ⌘= and ⌘0. View › Zoom In went to the app in the background this time and did nothing, so I used the same shortcut instead. |
| iOS Simulator | Devices exist (iPhone 17, 18 Pro, Air, iPad Pro, iPad mini), none booted, and no Paseo app in any of them. | Not used |
| Android emulator | `adb` exists, but there are no devices or emulators. | Not used |

To view states no live provider is in today, a throwaway browser session ran an init script. It swapped the parsed `provider-usage.get` result for a synthetic snapshot inside that page only. Nothing was written to `~/.local/state/paseo-provider-usage/`, and the plugin and daemon were not touched. The script and its screenshots were deleted, and the session was closed. Those states were: two provider errors, a near-limit window, all-estimated windows, a card with only unavailable fields, a card with only a balance, and long OpenRouter model ids with thousands-separated dollars.

## What was wrong (before)

The "before" screenshots contain real account data, so they are not committed.

### Phone (320 to 430 px)

- The page repeated the host's title: the host header says "Usage", and the page started with another "Usage" heading.
- The headline sat beside the name at every width. At 360 px, Antigravity's header broke into a tag, "100%", and a lone "used" on separate lines, plus a three-line caption ending in "6:44 / PM".
- At 320 px the meta line truncated, so Claude's source showed as "OMP …" and Codex's as "Co…".
- Section labels, tags, and footnotes were 11 px.
- Touch targets were too small: Refresh and "Show all models" were bare text links about 18 px tall, the Details toggle about 20 px, and the range tabs 24 px. A chart bar was the only way to pick a day, and at 30 days on a 320 px phone a bar is about 6 px wide.
- Limit rows wrapped their reset text mid-phrase.
- The last card had 16 px below it, close to a home indicator.

### Tablet (700 to 1100 px) and desktop

- The content was always one 640 px column, with the breakpoint taken from the host's `compact` flag only.
- In the iPad-landscape web pane (860 px) and the 1440 × 900 pane (1120 px), up to half the width was empty and about 1.5 cards fit on a screen.
- The desktop app's 1200 × 800 window (863 px pane) looked the same.

### All sizes

- **Dark theme:** accent-colored text ("Refresh", "Details", "Show all models") measured 2.7:1 on the dark card, which fails 4.5:1; light was 5.3:1. Chart bars were accent at 40% next to an accent selection, so the selected day was hard to see in dark.
- **Errors:** a provider error was a single red sentence inside the card.
- **Estimates:** an all-estimated card repeated the Estimate tag on every row.

## What changed and why

| Area | Change | Why |
| --- | --- | --- |
| Breakpoints | Measured with `onLayout` on the ScrollView. One column (max 640 px) below 720 px; two columns (max 1160 px) from 720. The headline sits beside the name only with at least 420 px of card content. The range tabs share the title row only with at least 420 px of activity-card content. | The pane is narrower than the window whenever the host shows a sidebar or split view. The 420 px headline threshold came from the 860 px pane, where 358 px of card content squeezed the caption into "6:44 / PM". |
| Grid | Row by row, two cells with `flex: 1`, stretched to equal height, with the Details footer pinned to the bottom (`marginTop: auto`). | Even rows, and reading and focus order stay Claude, Codex, Antigravity, OpenRouter, OpenCode Go, Baseten. A masonry split gives no shorter page with this data and reorders the cards. |
| Agent activity | Spans both columns. On wide panes the chart is 128 px (96 on narrow) and the models list in two columns, in rank order down each column. Bars are capped at 64 px wide, while the touch area stays the full column. New previous and next buttons (44 × 44, accessible names such as "Previous day", disabled at the ends) step through buckets, and the summary is a polite live region. | Tappable bars get too thin on phones; the stepper also works from the keyboard. Uncapped bars turned into 150 px slabs at 7 days. |
| Touch | Each pressable box is at least 44 pt, with the visible pill drawn inside it: Refresh (36 pt pill), range tabs (36 pt pill in a 44 pt box), "Show all models", the Details row, model rows, and the stepper. Measured in the DOM at 390 px: every button and tab is 44 pt or more. | `hitSlop` is not reliable on the web client, so the box itself is the target. The one exception is chart bars at 24 h or 30 d on phones; the stepper covers them. |
| Type | Four sizes: 12/16 caption (meta, kickers, tags, notes), 14/20 body (rows), 16/22 title (provider name, key figure), 20/26 display (section titles, headline, stats). Tags, tabs, kickers, and big figures cap growth at 1.3× with `maxFontSizeMultiplier`. Rows wrap instead: the value drops under a label that leaves no room, and labels have `minWidth: 0`. | One small scale, nothing under 12, and nothing clips at large text sizes. |
| Spacing | Tokens 4, 8, 12, 16, 24, 32. Page padding 16 compact / 24; card padding 16 / 20; grid gap 12 / 16; 48 px (compact) or 40 px below the last card. | A consistent rhythm, and room past a home indicator. |
| Color | Text is only `foreground` or `foregroundMuted`. Accent and danger are used for fills, tints, dots, and icons only. Tags have foreground text on a 16% tint of their meaning color plus a colored dot. A critical row has a red bar, an alert icon, and a bold percentage, and the header says "Near limit" or "Limit reached". Chart bars are neutral, with only the selected one in accent. | Contrast no longer depends on a light surface. |
| States | An error is a tinted callout with an icon, "Couldn't load usage", and the provider's message. When every limit on a card is an estimate, one "Estimates" tag sits beside the Limits heading instead of one per row. "Not available from the API" has an info icon. | A failing provider still looks designed, and repeated tags are noise. |
| Header | The duplicate page title is gone. "Plans" is the section title, with "Updated 8:38 PM" under it and a Refresh pill with an icon. | The host already shows "Usage". |
| Long labels | On narrow cards the per-model request count moves under the model id. Ids wrap or end in an ellipsis after two lines, and the amount stays visible. | At 320 px, "$530.39" ran past the card edge, because "deepseek/deepseek" would not shrink. |
| Details toggle | The hint uses fixed short words ("Per model · Activity · 2 notes") and is hidden while the section is open. The label never shrinks. | The old hint truncated to "2 no…", and "Hide details" wrapped onto two lines at 320 px. |
| Pull to refresh | iOS and Android only (`layout.platform !== "web"`), a `RefreshControl` that calls the same explicit refresh as the button. | A native gesture. It is a user refresh, not a new fetch trigger. |

Files: `client/main.tsx`, `client/parts.tsx`, `client/provider-card.tsx`, `client/activity-card.tsx` (new), `README.md` (layout text, refresh, file table, how to check sizes), and this report.

## Before and after, by size

| Size | Before | After |
| --- | --- | --- |
| Phone 320 to 430 | A duplicate title and a 640 px-style layout squeezed onto a phone. The headline fought the name, meta lines truncated, text was 11 px, targets were about 20 px, and accent text was hard to read in dark. | The section header has a 44 pt Refresh pill. Each card shows its name, tag, and full meta, then a large headline figure with its caption under it. Limit rows wrap the reset text as a whole phrase, and the range tabs fill the card width. Nothing is truncated except two-line model ids, and their values stay visible. There are 48 px below the last card. Checked at 320, 360, and 390 (2× and 3×). |
| Tablet portrait | One 640 column; the 500 px iPad pane with the sidebar was the same as a phone. | 500 px pane (820 × 1180 with sidebar): one column with stacked headlines. 704 px pane (1024 × 1366): one 640 column, headline beside the name, and Plan beside Balance inside the card. |
| Tablet landscape | One 640 column in an 860 px pane, with about 1.5 cards per screen. | Two equal-height columns of 398 px cards with stacked headlines, about two rows per screen. Agent activity spans the width, with a 128 px chart and two model columns. |
| Desktop | One 640 column in the 863 px (Electron) and 1120 px (web) panes. | Electron 1200 × 800: two columns. 1440 × 900 web: two columns of 528 px cards with the headline beside the name, and Plan beside Balance inside Claude. |

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passes (after every client edit). |
| `npm test` | 43 of 43 pass. |
| `paseo plugin reload provider-usage` | Reloaded after each tested build. Plugin `running`. |
| Web, phone, light | 320 × 640 @2, 360 × 780 @2, 390 × 844 @2 and @3; full-page walk at each. |
| Web, tablet, light | 820 × 1180 (pane 500), 1024 × 1366 (pane 704), 1180 × 820 (pane 860), 1366 × 1024 (pane 1046). |
| Web, desktop, light | 1440 × 900 (pane 1120). |
| Web, dark | 390 × 844 (live and synthetic states) and 1180 × 820 (live). |
| Synthetic states | Errors, Near limit, all Estimates, unavailable-only and balance-only cards, long ids, and thousands separators, at 320 and 390 px, light and dark. |
| Electron desktop | Zoom 0 (window 1200, pane 863): two columns. Level 1 (about 1000, pane 663): one column, headline beside the name. Level 2 (about 833, pane 496): one column, stacked headline, not compact. Level 6 (about 400) and level 7 (about 335): the host's compact layout, nothing clipped. Restored with ⌘0. |
| Host `compact` flip | Off at a 635 CSS px window (round 1) and at 833; on at 482 (round 1) and 400. So it flips between 482 and 635. |
| Keyboard | 16 Tab presses at 390 px went through the five Details toggles in card order, the five range tabs, then the chart bars (Refresh was skipped while disabled during an update). I did not tab as far as the stepper. With "Previous day" focused, Enter moved the selection from Tue 11/10 to Mon 11/9. "Next day" is disabled on the last bucket. |
| Touch sizes (DOM, 390 px) | Refresh 95 × 44, Details 326 × 44, range tabs 64 × 44, stepper 44 × 44, model rows 44 tall, chart bars 44 × 96 at 7 days. |
| Static | No hex, `rgb()`, or `hsl()` in `client/`; no text in `accent`; no font size under 12; no `*.server` imports in the client; no em dashes in the changed files. |

Final pane-only screenshots, light theme, contain real account emails and are not in the repo.
- `phone-1` to `phone-6`: 390 × 844 at 3×.
- `tablet-portrait-1` to `tablet-portrait-3`: 820 × 1180 with the sidebar, and 1024 × 1366.
- `tablet-landscape-1` to `tablet-landscape-3`: 1180 × 820.
- `desktop-1` to `desktop-3`: 1440 × 900 web.
- `desktop-4`: Electron 1200 × 800 at actual size.

### Unverified

- iOS and Android rendering. No simulator has the Paseo app and no emulator is running, so I saw no native render, including pull to refresh, which exists only there.
- Large system font sizes. `maxFontSizeMultiplier` has no effect on the web client, so the 1.3× cap and the wrapping rows were not seen under Dynamic Type or Android font scale.
- VoiceOver and TalkBack output. I checked accessible names and states in the DOM and the accessibility tree, but did not run a screen reader.
- Touch on a real device. The headless phone viewports render at phone width and density, but I did not enable touch emulation.

## Decisions for the owner

- **Two columns from a 720 px pane.** With equal-height rows, a shorter card keeps empty space under its content: Codex beside Claude, and OpenRouter beside Antigravity. I chose that over a masonry layout, because masonry gave no shorter page with today's data and would reorder the cards. Say if you prefer top-aligned cards of natural height.
- **No page title.** The in-page "Usage" title is removed because the host already shows it. "Plans" and "Agent activity" are now 20 px section titles.
- **Neutral chart bars.** Chart bars are gray, with the selected bucket in the accent color.
- **Pull to refresh.** It is enabled on iOS and Android only, and I could not test it.
- **Screenshots (done after review).** `docs/screenshot.png` (desktop), `docs/screenshot-tablet.png` (1180 px landscape, two columns), and `docs/screenshot-phone.png` (390 px, one column, first three cards) are now in the README. They were captured from the daemon's web client in a headless browser, light theme. Account emails were replaced in the page itself ("account redacted") before capture, each image was cropped to the Usage surface so no sidebar or workspace names are in it, and the palette was reduced to keep each file near 100 to 360 KB. The raw captures and the agent's screenshots (which show real emails) were deleted from `/tmp`.
- **`agy` hold across reloads.** After the redesign agent flagged that each reload re-ran `agy`, `restoreSnapshot` now seeds the 15 minute hold from the saved snapshot's Antigravity entry (only a successful answer, only inside the window). Tests cover it.
