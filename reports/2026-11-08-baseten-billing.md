# Baseten billing, credits, and spend

Date: 2026-11-08

## Decision

Baseten is a sixth provider row. CodexBar has no Baseten provider, so this is the one row the
plugin reads straight from a provider API: `GET https://api.baseten.co/v1/billing/usage_summary`
with a workspace API key. The row shows the last 30 days of spend, the credits Baseten applied,
what is still due, spend by Model API model name, and the token counts behind it.

Baseten reports no session, weekly, or monthly quota window, so the row has no bar. It also
reports no credit balance through its API, so no balance is shown.

## Field meanings

Each category in the response carries `subtotal`, `credits_used`, and `total`. The billing docs
describe "subtotal" as net of credits in one schema and before credits in another, so the live
account settled it: on 2026-11-08 the Model APIs category read `2.29 / 2.24 / 0.05` while the
starting credits ran out. Charges before credits can only be the larger number, and what is due
can only be the smaller one. The row therefore reads:

- `subtotal` as the charge before credits,
- `credits_used` as the credits applied,
- `total` as the amount due after credits.

The rows are labelled "Model APIs", "Credits applied", and "Due after credits" to match.

## Verification

Against the live workspace on 2026-11-08:

| Row | Value |
| --- | --- |
| Model APIs (30 days) | $2.29 |
| Credits applied | $2.24 |
| Due after credits | $0.05 |
| Top model | DeepSeek V4.1 Flash 1017 Fast, $2.29 |
| Input tokens | 76.3M |
| Cached input tokens | 74.4M |
| Output tokens | 54.3K |

Dedicated inference, training, and Loops were all zero, so those rows are omitted rather than
shown as empty. The row note says where the credit balance actually lives.

## Credential

The key comes from `BASETEN_API_KEY` when the daemon sets it, otherwise from the Baseten login Pi
already stores at `~/.pi/agent/auth.json`. That reuses an existing local agent login instead of
adding a credential store, the same way the Claude row borrows an OMP token. The key is sent only
to `api.baseten.co`, never written to the snapshot, and failed requests report the HTTP status
only, so a response body cannot echo it.

## Errors

- No key: the row explains both ways to provide one and links the key page.
- 401, 403: the key was rejected, with a link to mint a new one.
- Other status, timeout, or transport failure: one sentence with the status code, no response body.

## Tests

`tests/usage-errors.test.cjs` covers the spend mapping with a real-shaped summary: spend, credits
applied, amount due, per-model rows, and the note. A second test feeds an account with no usage
and asserts the row invents neither a dollar figure nor a balance.
