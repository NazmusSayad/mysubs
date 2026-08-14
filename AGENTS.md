## Developing `mysubs`

Use these projects as the source of truth for provider APIs:

- openusage: https://github.com/robinebers/openusage
- CodexBar: https://github.com/steipete/CodexBar

Before adding or changing a provider, check both projects for its endpoint,
headers, authentication, and usage mapping. Confirm the result with a real API
response. Do not guess.

To add a new provider, follow the existing architecture and copy the closest
provider. Add its config, detection, and usage fetching, then connect it to
account resolution, fetching, and rendering.

Keep each account independent so one failure does not stop the others. Never
store, log, or display secrets or email addresses. If the API does not provide a
value, do not invent one.
