---
name: emb-orchestrate
description: Merge next, dispatch, and context-hygiene signals into one orchestrator contract.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-orchestrate

## Purpose

- Merge next, dispatch, and context-hygiene signals into one orchestrator contract.

## Usage

- Run `$emb-orchestrate` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- Use `orchestrate run` in runtime CLI when you want the orchestrator recommendation to execute immediately instead of returning only the contract.
- If host sub-agent bridge support is configured, `orchestrate run` will forward self-contained worker prompts through the bridge and persist returned worker results, synthesis status, and integration status.
