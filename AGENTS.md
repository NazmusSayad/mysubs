## Developing `mysubs`

Before adding or changing a provider, check both projects for its endpoint,
headers, authentication, and usage mapping. Confirm the result with a real API
response. Do not guess.

To add a new provider, follow the existing architecture and copy the closest
provider. Keep its config, detection, account client, and display details inside
the provider, then add it to the central registry.

Keep each account independent so one failure does not stop the others. Never
store, log, or display secrets or email addresses. If the API does not provide a
value, do not invent one.

Use these projects as the source of truth for provider APIs:

- openusage: https://github.com/robinebers/openusage
- CodexBar: https://github.com/steipete/CodexBar
