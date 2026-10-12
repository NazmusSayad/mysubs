# mysubs

Check how much of your AI subscriptions you have used, across accounts and providers, in one place.

## Usage

```sh
mysubs            # show usage for all accounts
mysubs codex      # show only codex accounts
mysubs work       # show only the account with the alias "work"
mysubs codex:     # show only automatically detected codex accounts
mysubs codex claude zen # select multiple providers or accounts
mysubs -j         # print results as JSON
mysubs -f         # ignore the cache and fetch fresh data
```

## Install

```sh
npm install -g mysubs
```

## Configuration

Create `~/.config/mysubs/config.json`. Accounts that already exist on your machine
(like Codex or Claude logins) are detected automatically, so you may not need a config
file at all.

List your accounts in `accounts`, in the order you want them shown:

```json
{
  "$schema": "https://github.com/NazmusSayad/mysubs/raw/refs/heads/schema/schema.json",
  "contrast": 0.4,
  "nerdFont": true,
  "maxWidth": 120,
  "accounts": [
    { "provider": "claude", "alias": "personal", "configDir": "~/.claude" },
    { "provider": "codex", "auto": true },
    {
      "provider": "codex",
      "alias": "work",
      "name": "Work",
      "configDir": "~/.config/codex"
    },
    { "provider": "codex", "adapter": "opencode-oauth" },
    { "provider": "openrouter", "apiKey": "env:OPENROUTER_API_KEY" },
    {
      "provider": "opencode",
      "product": "go",
      "apiKey": "env:OPENCODE_API_KEY"
    },
    {
      "provider": "opencode",
      "alias": "zen",
      "product": "zen",
      "cookie": "key:opencode-zen"
    },
    { "provider": "copilot", "source": "gh" },
    {
      "provider": "copilot",
      "alias": "copilot-work",
      "source": "token",
      "token": "key:copilot-work"
    }
  ]
}
```

`{ "provider": "codex", "auto": true }` puts the automatically detected Codex
accounts at that position. `name` and `info` on an `auto` entry replace them on
every account it detects. Providers that do not appear in `accounts` at all
are detected and shown after the listed ones. Set `"detect": false` at the root
to turn that off, or list providers in `skipDetect` to leave only those out,
such as `"skipDetect": ["copilot"]`. Manual accounts of a skipped provider
still show.

`alias` lets you select an account directly, such as `mysubs work`. Aliases must
be unique and cannot be a provider name. An alias on an `auto` entry selects
all of its detected accounts. `name` is an optional display name. `info`
overrides the account info reported by the provider (the name shown after `›`);
set it to a string to replace it, or to `false` to hide it.

`cache` at the root turns caching on or off for every account (on by default),
and `cache` on an entry overrides it for that entry.

Configs in the old format, with accounts nested under each provider, are
migrated automatically on the next run. The original file is kept as
`config.json.bak`.

Codex accounts also come from the opencode CLI's stored OpenAI OAuth login
(`~/.local/share/opencode/auth.json`). That login is detected automatically
alongside native Codex logins, and `{ "adapter": "opencode-oauth" }` adds it as
an explicit account. Set `authPath` to point at a different opencode `auth.json`.
Refreshed tokens are written back to opencode's `auth.json`, so both tools stay
signed in.

OpenCode v2 keeps its logins in `~/.local/share/opencode/opencode.db` instead.
The `opencode2-codex` provider detects the Codex logins stored there and shows
them as Codex accounts. To add one explicitly, use its `credentialID`, and set
`databasePath` to read a different database. mysubs only reads this database,
so open OpenCode to refresh an expired login.

## Secrets

Never put a raw API key in the config. Reference it instead, and mysubs will resolve it
at run time:

- `env:NAME` — read from an environment variable
- `key:NAME` — read from your OS keyring, stored with `mysubs key set NAME`

```sh
mysubs key set openrouter   # prompts for the secret, stores it in the keyring
mysubs key get openrouter   # prints the stored secret
```

OpenCode Go uses an API key. Zen usage requires an authenticated `Cookie` header
from `opencode.ai`; optionally set `workspaceID` to select a specific workspace.

## Antigravity

Antigravity reports two shared quota pools, each with a rolling 5-hour and a
weekly window. Gemini Flash and Pro share `session` and `weekly`; Claude and
GPT-OSS share a second pool, shown as `other` and `other weekly`.

Usage comes from the Antigravity CLI itself, so no token or sign-in is needed
beyond running `antigravity` once. If the CLI is already running, mysubs asks it
directly; otherwise it starts one in the background, reads the quota, and stops
it again. Set `cliPath` on the account or `ANTIGRAVITY_CLI_PATH` when the `antigravity`
(or `agy`) binary is not on your `PATH`.

Because a cold read starts the CLI, it takes a few seconds; the cache keeps
later runs instant. This is a Google-internal interface and may change.

## GitHub Copilot

Copilot reads a GitHub token. Detection uses `GITHUB_TOKEN`, then `GH_TOKEN`, and
falls back to `gh auth token` when the GitHub CLI is installed and signed in, so
`gh auth login` is usually all the setup you need.

To configure it explicitly, set `source` on the account:

- `"source": "gh"` — run `gh auth token` at fetch time
- `"source": "token"` — resolve `token` from an env var or the keyring

Paid plans meter AI credits, shown as `credits`. Chat and completions are
unlimited there and stay hidden; on the free plan they show instead. Org-managed
Business/Enterprise seats report no per-seat quota, so only the plan is shown.
