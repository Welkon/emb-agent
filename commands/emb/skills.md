---
name: emb-skills
description: Discover, inspect, and run emb runtime skills.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-skills

Use `skills` to inspect the lazily loaded skill catalog exposed by `emb-agent`.

This is support surface for longer embedded sessions. It can add leverage, but it is not the default day-one firmware-project path.

## Commands

- `skills list`
- `skills show <name>`
- `skills run <name> [--isolated] [input]`

## Notes

- Discovery stays metadata-only; full skill bodies load only on `skills show` or `skills run`.
- `--isolated` uses the configured host sub-agent bridge when available.
