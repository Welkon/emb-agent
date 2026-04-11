---
name: emb-bootstrap
description: Show the staged bootstrap sequence that closes init, truth, adapter, and next prerequisites.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-bootstrap

## Purpose

- Show the staged bootstrap sequence for the current project.
- Use `$emb-bootstrap` when you need the shortest dependency-ordered path from `init` to `next`.

## Usage

- Run `$emb-bootstrap` to inspect bootstrap stages.
- Run `bootstrap run [--confirm]` in runtime CLI to execute the first auto-runnable bootstrap stage.
- If the next stage is the default remote `adapter bootstrap`, `bootstrap run` should stop and require an explicit source or manual network-enabled execution first.
- Use `bootstrap run --confirm` when the current bootstrap stage is gated by write permissions or explicit confirmation.
