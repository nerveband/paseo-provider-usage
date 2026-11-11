# Usage screen: reorder, collapse, grid and list, search and filters

Date: 2026-11-11.

## Outcome

The owner can now arrange the Usage screen and find things on it quickly:

- **Reorder** the six provider cards by dragging a grip, with a mouse or a finger, in Grid and in List. Keyboard and screen reader users get **Move up** and **Move down** buttons on the grip, and every move is announced.
- **Collapse and expand** any card, or the Agent activity section, by pressing its header. A collapsed card opens from anywhere on it. **Collapse all** and **Expand all** are in the layout menu.
- **Grid or List**: Grid is the existing responsive card layout. List is one compact row per provider that opens to the full card in place.
- **Search and filter**: a search field over everything the cards show, plus four chips (All, Near limit, Has balance, Needs attention) with counts, a "Showing 3 of 6" line that also reports hidden errors, and an empty state with Clear.
- **Persistence**: order, collapsed cards, and the view are saved by the Paseo daemon's own plugin settings store and pushed to every client of the same daemon. **Reset layout** restores the defaults.

`npm run typecheck` passes. `npm test` passes 60 of 60 (43 existing, 17 new). Everything below was checked on live data in the daemon's web client (headless Chromium, mouse and real touch events) and, by keyboard, menu, and scroll only, in the Paseo desktop app. The owner's layout was reset to the defaults afterwards.

## Owner request during the work

Partway through, the owner asked to expand and collapse by pressing the whole area, not just the small chevron. The card header is now one button: name, plan tag, account line, headline, chevron, and the card's padding around them. A collapsed card is all header, so it opens from anywhere except its grip. The Agent activity header row works the same way. The chevron stays as the state indicator. The grip is a separate control outside the header button, so dragging and the Move buttons are unaffected. Checked live: clicks on the name, on the top-left corner, and on the bottom padding of a collapsed card all toggle it; a click on the grip opens the Move buttons and does not toggle; a touch tap on a collapsed card's lower area opens it.

## What I built and why

### Interaction design

| Feature | Design | Why |
| --- | --- | --- |
| Toolbar | One row: search field, Grid and List switch, and a **⋯** layout menu (Collapse all, Expand all, Reset layout). A second row of filter chips. A "Showing N of 6" line appears only while filtering. | The restraint the brief asked for. Reset is reachable but one step removed. |
| Grip | Six dots in each card's top-right corner, always visible, muted, 44 × 44 pt. The cursor is `grab` on the web. | iOS puts its reorder control at the trailing edge; the leading edge would push every name away from the body's left edge. Always visible because hover does not exist on touch. |
| Drag feedback | The lifted card scales to 1.02, gets an opaque surface, a theme-colored shadow, and a faint outline. The landing slot gets an accent fill under the card and an accent outline over it, so it shows even while the card covers it. In List view the cards in between slide aside to open a gap; in Grid view the slot the card left is faintly filled. | Feedback that reads on light and dark themes, with every color from `theme.colors`. |
| Keyboard path | Pressing the grip (Enter, Space, click, or tap) opens **Position 3 of 6 · Move up · Move down · Done** under the card's header. Focus stays on the pressed Move button after the card moves. Screen readers also get Move up and Move down as accessibility actions on the grip. A polite live region (the platform announcer on iOS and Android) says "Claude moved to position 3 of 6". | A visible path for keyboard and motor-impaired users, not only an invisible screen reader action. |
| Collapse | Pressing a header collapses the card to name, plan tag, account, and headline. A collapsed card that failed to load still shows a "Couldn't load usage" tag. In the grid, a collapsed card keeps its own height instead of stretching to its neighbor's. Details inside a card is unchanged. | Six headlines scannable at once; an error never disappears behind a fold. |
| List view | One row per provider: name and plan tag (plus Limit reached, Estimate, or Couldn't load tags), the headline figure, a thin bar for the tightest limit, its label and reset, and the first balance figure (left out when the headline already is that balance). From a 560 pt pane the parts sit in aligned columns on one line; on phones they stack. Pressing a row opens the full card in place; pressing that card's header closes it. | Dense scanning, same cards and type scale. |
| Search | Every word must appear somewhere in a block: name, plan, account, source label, window labels, percentages, amounts, reset text, flags, group and panel titles, row labels and values, Details content, notes, and errors. It also filters the Agent activity model list by model name; the activity section stays when its own words match ("activity", "sessions", "estimate"). `/` focuses the field on the web and desktop clients unless you are typing elsewhere or the screen is hidden; Escape clears it. | "balance", "weekly", "$0", and "estimate" all find something on today's data. |
| Filter chips | Near limit: any window at or above `CRITICAL_USED_PERCENT` (90) on the provider's own percentage, rounded the same way the card rounds it. Has balance: a balance group with a reported value. Needs attention: a provider error, an estimated window, or a field the API does not expose. Each chip shows how many providers it would show after the search. A quick filter hides Agent activity, which has no limits or balances. | Derived only from data that exists. |
| Hidden errors | "Showing 2 of 6 · 1 hidden provider couldn't load" whenever a filter or search hides a provider that failed. Errors always match Needs attention. | A filter never hides a failure silently. |

### Drag approach and its limits

React Native primitives only, no new dependency:

- A `PanResponder` sits on a view around each grip's `Pressable`. It claims the touch at once (capture on start), refuses to give it up, and blocks the native responder, so a drag that starts on the grip never scrolls the page. The `Pressable` inside keeps keyboard focus, Enter and Space, the click on the web, and accessibility actions. On iOS and Android a press that does not move is handled as a tap by the responder; on the web the browser's click does it, and the click that follows a drag is ignored for 400 ms.
- The layout does not change during a drag. The lifted card and, in List view, its neighbors move by `Animated` transforms, so the dragged view stays mounted and keeps its gesture. On drop the card settles into place (150 ms), the order is committed, and a layout effect clears the transforms before the next frame.
- Targeting uses frames measured with `onLayout`. The slot is the frame that contains the lifted card's center, else the nearest frame by distance to its edges. That works for the two-column grid and for one column, and a tall card does not lose to the center of a shorter one.
- Auto-scroll runs a frame loop while the pointer is within 72 pt of the viewport's top or bottom, up to 18 pt per frame, and the lifted card stays under the pointer as the page moves.
- Web specifics: the grip has `touch-action: none` (touch drags work and swipes elsewhere still scroll) and `user-select: none`; text selection is off during a drag. Native specifics: the page's scrolling is turned off while a card is lifted.
- Reduced motion (`AccessibilityInfo.isReduceMotionEnabled` and its change event) skips the lift spring, the slide, the settle, and the fade-in when a card opens.

Limits:

- In Grid view the other cards do not reflow while you drag; the target slot is marked instead. Grid rows have different heights, so a live reflow would make cards jump. List view slides its rows because one column is exact.
- Agent activity is not draggable and stays last. It spans the full width, and placing it between grid rows would leave half-empty rows. It is collapsible and searchable.
- With a search or filter active you reorder what you see: a card moves before or after the visible card it displaces, and hidden cards keep their places. Positions in the announcement say "of 3 shown".
- No long press. The grip drags at once, like the iOS reorder control. That fights the scroll only on the 44 pt grip itself.

### Data model and where it is stored

I checked the SDK first, as asked. `@getpaseo/plugin` 0.15.0 declares `defineSettings`, `server.registerSettings`, and a client `useSettings` hook, and both clients on this machine supply the hook (the daemon's web client 0.15.4 and the desktop app 0.15.3 map it into `@getpaseo/plugin/client`). The daemon (0.15.4) implements it in `PluginSettingsStore`: one JSON file per definition at `<paseo home>/plugin-settings/<plugin id>/<id>.json`, written to a temporary file with mode 0600 and renamed, with a revision check that refuses a stale write, and a `plugin_settings_changed` push to every connected client. The client side is a replica query with no refetch on mount, focus, or reconnect, so there is no polling. I used it instead of adding an RPC pair and a server module.

| Item | Value |
| --- | --- |
| Definition | `layoutSettings` in `shared/usage.ts`: id `layout`, scope `host`, version 1. Registered in `index.server.ts` with `server.registerSettings`. |
| File | `~/.paseo/plugin-settings/provider-usage/layout.json`, mode 0600 (its folder is 0755 inside the 0700 `~/.paseo`, both created by the daemon). Not under `$XDG_STATE_HOME`: the brief named that path for a home-made store, and the host store decides its own location. |
| Contents | `{"version":1,"values":{"order":[...provider ids],"collapsed":[...block ids],"view":"grid"|"list"}}`. Nothing else: the schema keeps known ids once and the two view names, and drops everything else. |
| Defaults | Empty order (the server's order), nothing collapsed, Grid. |
| Providers added or removed | Stored ids that no longer exist are dropped; new providers append in default order (`mergeOrder`). |
| Unreadable file | The host reports it as invalid; the screen uses the defaults; the next change resets the file and then saves. |
| Saving | Changes apply at once and are saved 500 ms after the last one, one write at a time. A failed save keeps the change on screen and adds "Layout not saved" to the caption under Plans. It is retried only after a new change or after another client's save moves the revision, so it cannot loop. A pending change is saved when the screen closes. |
| Not saved | Search text, the chosen chip, which List rows are open, which card shows its Move buttons. |
| Waiting | The cards wait for the stored layout for at most 1.5 s before drawing the defaults, so the order does not jump on open. |

The quiet-fetch design for provider data is unchanged: the same `provider-usage` query, the 60 s freshness window, the five minute interval, the 2 s poll only while a background fetch runs, holds, and Refresh. The layout makes no provider call.

### Breakpoints touched

| Rule | Before | Now |
| --- | --- | --- |
| Headline beside the name | Card content ≥ 420 pt | Card content minus 68 pt for the chevron and grip ≥ 420 pt. At 1440 × 900 (pane 1120) it is still beside the name; at the 860 pt tablet pane and the 863 pt desktop window it stacks, as before. |
| Grid | Rows of two `flex: 1` cells | One wrapping row with cells of half the measured width, so React moves a card's view instead of remounting it when the order changes. Rows still share one height. |
| Grid and List switch | none | Icons only below 420 pt of content. |
| List columns | none | One line of columns from 560 pt of content. |
| Filter chips | none | One row that scrolls sideways and runs to the pane's edges. |

### Code structure

| File | Role |
| --- | --- |
| `shared/layout.ts` (new) | Pure logic, no React or Node: preferences, sanitizing, `mergeOrder`, `moveItem`, `reorderVisible`, `slotAt`, the search text and matcher, the filter predicates, `CRITICAL_USED_PERCENT`, and the display helpers the card, the row, and the search share (`displayPercent`, `sourceLabel`, `tightestWindow`, `limitFlag`, `keyBalance`). |
| `shared/usage.ts` | `layoutSettings`; the provider id enum now comes from `PROVIDER_IDS`. |
| `index.server.ts` | Registers the settings. No server module was added. |
| `client/use-layout.ts` (new) | Adopts the stored layout, applies changes at once, saves after a pause, and reports a failed save. |
| `client/reorder.tsx` (new) | The drag controller, the grip, and the Move buttons. |
| `client/toolbar.tsx` (new) | Search, Grid and List, the layout menu, chips, the count line, and the empty state. |
| `client/list-row.tsx` (new) | The List row. |
| `client/provider-card.tsx` | Header as one button, collapsed state, grip slot, fade-in when opened; helpers moved to `shared/layout.ts`. |
| `client/activity-card.tsx` | Filters its model list by search words. |
| `client/main.tsx`, `client/parts.tsx` | Composition; a few styles and the `Reveal` fade. `CRITICAL_USED_PERCENT` is re-exported from the shared module. |
| `tests/layout.test.cjs` (new) | 17 tests with synthetic data, below. |

## Verification

All on live data unless marked. Web runs used the daemon's web client in headless Chromium (`agent-browser`, sessions closed afterwards). "Touch" means real `Input.dispatchTouchEvent` touches over the browser's DevTools protocol with touch emulation on; `agent-browser`'s device preset alone reported zero touch points.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passes (after every edit). |
| `npm test` | 60 of 60. New: corrupt and hostile stored values fall back to defaults; unknown and repeated ids dropped, nothing but three keys kept; `invalid`, `error`, and `loading` settings states give defaults; the settings schema is host-scoped, stable when re-parsed, and JSON-safe; `index.server.ts` registers it; `mergeOrder` with added and removed providers; `moveItem` first, last, same slot, out of range; `reorderVisible` with hidden blocks and unknown ids; `slotAt` in a grid with a tall row, in gaps, outside, and in one column; search for "balance", "weekly", "$0", "estimate", account, source, Details rows, errors, multi-word, and no match; Near limit at 89, 89.4, 89.5, and 90; Has balance ignores unavailable rows; Needs attention for an error, an estimate, and an unavailable field; hidden-error counts; activity and model matching. |
| `paseo plugin reload provider-usage` | 06:35, 06:40, 06:44, 06:47, 06:48, 06:51, 06:54 UTC. `running` each time, no errors in the plugin log. The `agy` hold survives reloads. |
| Pointer drag, grid (1440 × 900) | Claude from position 1 onto OpenRouter's slot: lifted card, faint origin slot, accent target; dropped at position 4 with "Claude moved to position 4 of 6"; saved within a second. |
| Pointer drag, list, auto-scroll | All cards open (3438 px page). Codex held at the bottom edge: scrollTop 0 → 148 (0.7 s) → 627 (2.5 s), stopped when the pointer returned to the middle; neighbors slid aside and the gap was outlined; dropped at position 3. |
| Click after drag | No Move buttons opened after a drop. |
| Touch drag (390 × 844 @3, iPhone 14 preset) | Antigravity's grip dragged down two places: page scrollTop stayed 0 during the drag, cards slid up, dropped at position 3, no stray tap. |
| Touch swipe on content | Scrolled 0 → 853 px; order unchanged. |
| Touch taps | A tap on a collapsed card's lower area opened it; a tap on the grip opened the Move buttons. |
| Keyboard reorder (web) | Enter on "Reorder Baseten" opened the Move buttons (Move down disabled at the end); Tab, Enter, Enter moved Baseten from 6 to 4; focus stayed on "Move Baseten up"; live region "Baseten moved to position 4 of 6". |
| Header press (owner request) | Name, top-left corner, collapsed card's bottom padding, and the activity title each toggled; the grip did not. Accessibility tree: each card is a heading holding one button named with its summary; the grip is outside the heading. |
| Collapse all, Expand all | From the menu by keyboard: focus moved to the first item on open and back to the menu button on close; "All blocks collapsed" announced; Expand all is disabled when nothing is collapsed; Escape closes the menu. |
| Grid ↔ List | Both directions, saved; the active icon renders (an SVG under the pill's fill was hidden at first; fixed). |
| Search | balance → 6, weekly → 4, $0 → 3, estimate → Agent activity only (its cost note), claude → Antigravity (its Claude/GPT windows), Claude, and Agent activity with Claude models, zzqx → empty state with one Clear. |
| Chips | Near limit 1 (Antigravity, Gemini weekly 100%), Has balance 5, Needs attention 2 (Antigravity plan, Baseten balance), All restores; activity hidden under a chip. Pressing an active chip returns to All. |
| `/` and Escape | `/` focused the search without typing a slash; Escape cleared it and stayed on the screen. |
| Persistence across reload | After a full page reload: same order, List view; opened rows reset (by design). |
| Second device | A separate browser context at phone size showed the same order and view. A keyboard move in the desktop app appeared in the web client without a reload. |
| Corrupt file | Truncated JSON in `layout.json`: the screen drew the defaults; the next change rewrote a valid file (mode 0600, no temp file left). |
| Failed save | Settings folder made read-only for a moment: the change stayed on screen and the caption said "Updated 1:48 AM · Layout not saved"; after restoring the folder's permissions (755), the next change saved and the hint cleared. |
| Reduced motion | Emulated `prefers-reduced-motion`: an opening card's body was at opacity 0 at 40 ms without it (fading in) and at opacity 1 with it. |
| Touch targets and type (390 pt) | No control in the pane under 44 × 44 (grip 44 × 44 after widening it from 40); smallest text 12 px. |
| Light and dark | Desktop, tablet, and phone in both; text only in `foreground` and `foregroundMuted`. |
| Desktop app (Electron) | View › Reload through the menu; Return on the focused grip opened the Move buttons; Move down then Move up by Return; scrolling through accessibility. No mouse clicks; the renderer did not crash. |
| Static | No hex, `rgb()`, or `hsl()` in `client/`; no `*.server` import in the client; no font under 12; no em dashes in changed files. |
| Reset layout | From the menu: file back to `{"order":[],"collapsed":[],"view":"grid"}`, default order and Grid on both clients, "Layout reset" announced. Left in that state. |

Pane-only screenshots were taken for review and are not in the repo (they show real account emails): grid, list, menu, collapsed-all, mixed collapsed with hover, grid drag in progress, list drag with auto-scroll, row opened in place, keyboard move, search result, empty state, Needs attention, layout not saved, and after reload, in light and dark themes at desktop, tablet (1180 × 820), and phone (390 × 844, including a touch drag in progress) sizes, plus two desktop-app captures. The README screenshots were retaken afterwards with the account lines redacted.

## Not verified

- iOS and Android. No simulator has the Paseo app and no emulator runs here. Untested natively: the grip's `PanResponder` against a native `ScrollView`, turning scrolling off during a drag, auto-scroll, `announceForAccessibility`, focus moves with `sendAccessibilityEvent`, and the accessibility actions.
- VoiceOver and TalkBack. I checked names, roles, states, and the live region in the DOM and the macOS accessibility tree, not with a screen reader.
- A mouse drag in the desktop app (mouse input there is off limits). The same client code passed with a mouse in the web client.
- Two clients saving at the same instant. The host refuses the stale write; the code shows "Layout not saved" and saves again when the pushed revision arrives. I simulated a failed save, not a real conflict.
- Large system font sizes, and classic (non-overlay) scrollbars on Windows.

## Decisions for the owner

1. **Agent activity stays last.** It is collapsible and searchable but not movable. Say if you want it movable; it would sit on a full-width row between grid rows.
2. **Grid drags mark the target slot; List drags slide rows.** A live reflow in the grid would make cards of different heights jump.
3. **Open List rows are not saved,** and Collapse all or Expand all in List view opens or closes rows (plus Agent activity) without touching the grid's saved collapsed cards.
4. **Needs attention is never empty today.** Antigravity (no plan tier in its API) and Baseten (no balance field) always match, as the brief defined it. Say if fields the API cannot expose should not count.
5. **The whole header toggles the card.** On the web you can no longer select header text, such as the account line, by dragging across it.
6. **Where the layout lives.** In the daemon's settings store, so every app on this daemon shares one layout. A second daemon keeps its own.
7. **README screenshots** were retaken with the toolbar after review. Account emails were replaced in the page before capture, and each image is cropped to the Usage surface.
