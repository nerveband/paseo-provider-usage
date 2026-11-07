# Antigravity details, credits, and OpenCode Go

Date: 2026-11-07

## Decision

Antigravity now uses CodexBar's ambient source first and renders its four real quota lanes. Codex and OpenRouter now show their reported balances. OpenCode Go is a fifth provider row with its three estimated windows. Claude and Antigravity do not report a plan tier or credit balance through the CodexBar payloads available here, so those rows say so instead of showing an invented number.

## Antigravity

- Source: `cli` (shown as "Antigravity CLI").
- Gemini 5-hour: 100% used, resets in 2 hours 19 minutes.
- Gemini weekly: 53.55% used (screen rounds to 54%), resets Nov 13.
- Claude/GPT 5-hour: 0% used, resets Nov 8.
- Claude/GPT weekly: 0% used, resets Nov 14.
- The OMP token still exists as a fallback, but it reported `loginMethod: "Free"` and 0% for both lanes, so it is not used while the ambient source succeeds.

Fix: `normalize()` no longer drops `extraRateWindows` for Antigravity. When those lanes exist they replace the duplicated primary/secondary pair; labels come from `rateWindowLabels` and the lane titles. The `gpt-reserve` identifier filter remains.

## Credits and balances

- Codex: plan `prolite`. Credits remaining 56,493.99 (currency "Credits", period "Extra usage"). 2 full rate-limit resets available, next expiry Nov 30, 2026.
- OpenRouter: remaining $7.85, used $137.15, total added $145.00. Last 30 days: 28.1M tokens, 8k requests, 18 models.
- Claude: no plan tier or credit field in the OMP-backed payload. The row note says this.
- Antigravity: no credit field in the ambient payload. The row note says this.
- OpenCode Go: no plan tier or credit field in the payload. The row note says this.

"Left to top up" for OpenRouter is the reported remaining balance, $7.85. No target balance is configured, so the plugin cannot compute a top-up amount.

## OpenRouter by model

CodexBar exposes account-wide spend and a model count (18), not a dollar split per model. No per-model spend is shown, and the row note states that. The separate Agent activity section reports token share and estimated API-rate cost for models seen in local agent logs; that is not OpenRouter billing.

## OpenCode Go

- 5-hour: 0% used, resets Sat 10:24 PM.
- Weekly: 0% used, resets Sun 6:59 PM.
- Monthly: 0% used, resets Sat 6:48 AM.
- `dataConfidence: "estimated"` is shown as a note. The plain `opencode` provider was not added because its payload fails with "No OpenCode session cookies found in browsers."

## Files changed

- `server/usage.ts`: ambient-first Antigravity auth, extra-window rendering, credit/reset groups, OpenCode Go provider, source labels.
- `shared/usage.ts`: provider enum includes `opencodego`.
- `client/main.tsx`: source label in the provider meta line; existing spend groups render the new rows.
- `README.md`, `package.json`: provider list, plan wording, credits, OpenRouter limitation.
- `tests/usage-errors.test.cjs`: regression tests for Antigravity lanes, Codex credits/resets, and OpenCode Go labels/notes.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 17 passed, 0 failed.
- `paseo plugin reload provider-usage`: plugin running, no errors in logs.
- Surface checked in the running Paseo app via screenshot OCR. Confirmed Antigravity's four lanes, Codex `prolite` and 56,493.99 credits, OpenRouter $7.85 remaining and 18 models, and OpenCode Go's three 0% windows with the estimated note.
- No token, API key, or credential was printed or written to the snapshot.