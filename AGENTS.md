# Agent policy

This repository is a single trusted Paseo plugin that reports Claude, Codex, and Antigravity plan
usage in the Paseo sidebar. Backend code runs unsandboxed beside a Paseo daemon and handles OAuth
tokens, so treat every change as security-relevant.

## Ground rules

- Run `npm run typecheck` before any install or reload. A plugin that fails to typecheck will
  fail to load.
- Apply source edits with `paseo plugin reload provider-usage`. Never restart the Paseo daemon to
  pick up a change; a restart kills running agents, possibly including your own.
- Read `paseo plugin logs provider-usage` when a fetch fails. Do not add debug output that could
  print a token.
- Verify UI work in a real client at desktop and compact widths, in a light and a dark theme.
  Screenshot the surface element, not the whole window.

## Secrets

- Never log, print, echo, or commit a token, cookie, or credential. That includes error paths and
  test fixtures.
- Keep injected credentials in a `0600` file inside a private temporary directory, and delete the
  directory in a `finally` block.
- Never commit a screenshot or fixture containing a real account email, workspace path, or client
  project name. The committed screenshot has its account line redacted.
- Never widen the credential surface: read tokens from an existing local agent, never add a new
  credential store, prompt, or remote endpoint.

## Provider etiquette

- Provider quota endpoints are rate limited per account. Do not add polling, retry loops, or
  per-mount fetches.
- Preserve the existing quiet-fetch design: serve the last snapshot immediately, revalidate in
  the background, share one in-flight request, keep the 60 second freshness window and five
  minute revalidation, and bypass the cache only on explicit user refresh.
- The on-disk snapshot may hold usage numbers and an account label. Never write a token,
  cookie, or credential into it, and keep it at mode `0600`.
- Read OAuth tokens from cache first. A forced refresh mints a new access token and invalidates
  the previous one, so force it only after the provider rejects the cached token.
- Do not launch a provider GUI, IDE, or interactive TUI to obtain usage.

## Data honesty

- Bars encode a used share from zero. Do not truncate the baseline, scale by area, or rescale to
  make a value look dramatic.
- Never fabricate, interpolate, or default a missing number. A window with no reported usage is
  omitted; a provider failure renders as that provider's message. Identifier-named
  model-pool lanes are hidden because they mirror a real window; never hide a genuine limit.
- Every window row must show timing: the absolute reset timestamp when reported, else the
  provider's reset text, else the window length.
- Percentages shown to the user must be the provider's own values, clamped to 0-100 and rounded
  only for display.

## UI constraints

- The surface runs on desktop, web, iOS, and Android across every Paseo theme. Take all color
  from `theme.colors` and all density from `layout.compact`. Never hardcode a hex color or rely
  on React Native's default text color.
- Available tokens are `surface0`, `foreground`, `foregroundMuted`, `accent`, `accentForeground`,
  and `statusDanger`. Derive tints with an opacity layer rather than inventing a color.
- Keep every control keyboard reachable with an accessible name, and keep each quota row
  readable by assistive technology as label, percentage, and reset time.
- Color must never be the only signal. A critical row is red *and* near-full.

## Scope

- Keep the plugin one surface with one purpose. Route new backend behavior through a Zod RPC
  contract in `usage.shared.ts`; keep Node, filesystem, and credential access in
  `usage.server.ts`; keep React in `main.client.tsx`.
- Do not import `*.server` modules from client files or `*.client` modules from server files.
- Do not publish, release, or push to a remote without explicit approval from the repository
  owner.
