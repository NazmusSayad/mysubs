# mysubs

Check how much of your AI subscriptions you have used, across accounts and providers, in one place.

## Usage

```sh
mysubs            # show usage for all accounts
mysubs -s codex   # show only codex accounts
mysubs -s codex:work  # show only the "work" codex account
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

Example:

```json
{
  "$schema": "https://github.com/NazmusSayad/mysubs/raw/refs/heads/schema/schema.json",
  "contrast": 0.4,
  "nerdFont": true,
  "codex": {
    "accounts": [{ "name": "work", "configDir": "~/.config/codex" }]
  },
  "claude": {
    "accounts": [{ "name": "personal", "configDir": "~/.claude" }]
  },
  "openrouter": {
    "accounts": [{ "name": "main", "apiKey": "env:OPENROUTER_API_KEY" }]
  },
  "opencode": {
    "accounts": [
      { "name": "go", "product": "go", "apiKey": "env:OPENCODE_API_KEY" },
      { "name": "zen", "product": "zen", "cookie": "key:opencode-zen" }
    ]
  }
}
```

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
