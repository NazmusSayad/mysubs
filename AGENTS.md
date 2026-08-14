# Developing mysubs

## Start with the two reference projects

Everything mysubs knows about a provider's API was learned from two projects that
already do this well:

- **openusage** — https://github.com/robinebers/openusage
- **CodexBar** — https://github.com/steipete/CodexBar

Clone both and keep them open. They are the source of truth for which endpoint to
call, which headers to send, and how to turn the response into numbers. Never
guess at a provider's API, and never copy a mapping from here without checking it
against them first. Where the two disagree, trust the one whose numbers match a
real call you made yourself.

## How the tool works

It reads the config file, works out which accounts to check, asks every provider
at the same time, and prints the result. Each account stands alone: one that fails
shows its error on its own line and never stops the others.

## Adding a provider

A provider is a folder with three parts — what its config looks like, how to find
an account on the machine when the user hasn't configured one, and how to fetch
usage for a single account. Copy the closest existing provider and follow its
shape.

Then hook it up in five places: the config schema, account resolution, the fetch
step, the display title, and the brand colour. Search for an existing provider's
name and you'll find all five.

## Changing a provider

Read the matching provider in openusage and in CodexBar before you change a single
number — one keeps this logic in Swift, the other in small JavaScript plugins.
Then confirm against the live API yourself. If your number and theirs disagree,
one of you is wrong; find out which before shipping.

## Rules

- Secrets are only ever references to an environment variable or the OS keyring —
  never written in the config, never logged, never cached.
- Never show an email. Use the display name the provider gives, otherwise the
  account's folder.
- No data means no row. Never invent a limit and never turn a negative into zero
  to make something render.
- Parse responses defensively. These APIs are undocumented and fields come and go.
- No comments.
