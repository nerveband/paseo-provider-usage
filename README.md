# Paseo plan usage

A [Paseo](https://paseo.sh) plugin that shows your Claude, Codex, Antigravity, and OpenRouter usage in the sidebar. One click, no menus, no extra window.

![The Usage screen showing Claude, Codex, Antigravity, and OpenRouter usage above agent activity](docs/screenshot.png)

Each row is one usage limit. It shows the name, when it resets, how much you've used, and a bar. Rows turn red at 90% or more. The account line shows the plan, the account, and where the numbers came from.

Paseo already has some of this, but it's hidden in a tooltip and a settings page. This plugin keeps it in one place you can reach from the keyboard, and adds Antigravity, which Paseo doesn't show.

## What you see

- **Plans.** Session, weekly, and monthly limits for Claude, Codex, and Antigravity, with reset times.
- **OpenRouter.** Credit left, used, and added, plus 30 days of activity (tokens, requests, and models).
- **Agent activity.** Tokens, estimated cost, and sessions for the last 24 hours, 7, 14, or 30 days, or all time. Tap a bar in the chart to see that day, or tap a model to show only that model.

Some internal lanes, like `gpt-reserve`, are hidden. They copy a real limit and aren't something you plan around.

## Where the numbers come from

The plugin uses the [CodexBar](https://github.com/steipete/CodexBar) command-line tool. It reuses logins you already have, so you don't sign in again.

| Provider | Source |
| --- | --- |
| Codex | The Codex CLI's own login. |
| Claude | A login token from [OMP](https://paseo.sh/omp), or CodexBar's own methods if OMP isn't installed. |
| Antigravity | The same OMP login, or CodexBar's Antigravity checks, the `agy` CLI, or Google login. |
| OpenRouter | The API key saved in CodexBar, or `OPENROUTER_API_KEY`. |

No app window opens. You don't need the Antigravity app or an `agy` session running.

### Add an OpenRouter key

```bash
codexbar config set-api-key --provider openrouter --stdin   # paste the key, then press Ctrl-D
```

A normal key shows credits and that key's own spending. A Management key also shows 30 days of activity for the whole account. CodexBar doesn't report spending per model, so the plugin can't show it.

## Requirements

- Paseo 0.15.0 or later.
- The CodexBar CLI (`codexbar`). Put it on your `PATH` or in `~/.local/bin`, or set `CODEXBAR_BIN` to its full path. Get it from [CodexBar releases](https://github.com/steipete/CodexBar/releases) (macOS and Linux).
- Optional: OMP signed in to `anthropic` and `google-antigravity`, for the Claude and Antigravity rows.

## Install

```bash
paseo plugin install git:nerveband/paseo-provider-usage
paseo plugin ls
```

To check for updates and install them:

```bash
paseo plugin update provider-usage --check
paseo plugin update provider-usage
```

Then click **Usage** in the sidebar, or press `Cmd+K` (or `Ctrl+K`) and run **Open plan usage**.

## Settings

| Variable | What it does |
| --- | --- |
| `CODEXBAR_BIN` | Full path to CodexBar. If it's not set, the plugin looks on your `PATH`, then in `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`. |

Providers, refresh timing, and the red threshold are set in the code, in [server/usage.ts](server/usage.ts) and [client/main.tsx](client/main.tsx).

## How refreshing works

The screen opens right away with the last numbers it saved, then fetches new ones in the background. While it does, you see `Updating…` next to the time. You only see a spinner the very first time, before anything is saved.

Saved numbers live in `$XDG_STATE_HOME/paseo-provider-usage/snapshot.json` (usually `~/.local/state/paseo-provider-usage/`). Only your user can read the file. It holds usage numbers, reset times, and the account name, never a token.

Providers limit how often you can ask for usage, so the plugin asks rarely:

- Numbers less than 60 seconds old are reused without asking again.
- Older numbers show right away while new ones load in the background.
- If several requests come in at once, they share one fetch.
- The screen checks every five minutes. It checks every two seconds only while a background fetch is running.
- **Refresh** skips the saved numbers and waits for new ones.

The plugin reads Claude's login token from OMP first. It only asks for a new token if Claude turns the saved one down, because a new token cancels the old one.

## How agent activity loads

The plugin reads your local agent history files, up to eight at a time. It remembers files it has already read and only reads new lines when a log grows. If a log was cut short or replaced, it reads it again from the start. None of this affects the usage limits above.

## Security

- The plugin's server code runs next to your Paseo daemon, without a sandbox.
- Tokens go to CodexBar through a private temporary file that only your user can read. The file is deleted after each fetch.
- Tokens are never logged, printed, or saved in this repository.
- If one provider fails, only its row shows an error. The others still load.
- Raw error output from the CLI is replaced with a safe message before it reaches the screen or the saved file.
- Two development dependencies use local security patches. See [vendor/README.md](vendor/README.md) for what changed and why.

## Work on the code

```bash
npm ci                                 # keep the vendor/ folder, the lockfile needs it
npm run typecheck                      # run before every install or reload
npm test
npm audit
paseo plugin install "$PWD"            # first time only
paseo plugin reload provider-usage     # after each change
paseo plugin logs provider-usage
```

Don't restart the Paseo daemon to apply changes. That stops running agents.

| File | What it does |
| --- | --- |
| [index.server.ts](index.server.ts) | Registers the server handlers. |
| [index.client.tsx](index.client.tsx) | Adds the screen, the sidebar row, and the Command Center action. |
| [shared/usage.ts](shared/usage.ts) | Data shapes shared by the server and the app. |
| [server/usage.ts](server/usage.ts) | Tokens, CodexBar calls, caching, and activity totals. |
| [client/main.tsx](client/main.tsx) | The Usage screen. |
| [tests/](tests/) | Tests for activity loading, CLI errors, and dependency security. |
| [vendor/](vendor/) | Local security patches for two development dependencies. |

Check screen changes in the real app, in light and dark mode, at full and narrow widths.

## Credits

Usage data comes from [CodexBar](https://github.com/steipete/CodexBar) by Peter Steinberger.

## License

[MIT](LICENSE)
