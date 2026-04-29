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
- Use `prefs set orchestration_mode <auto|coordinator|fork|swarm>` when the session should stay on a coordinator pattern, fork inherited-context workers, or run a flat swarm roster.
- If host sub-agent bridge support is configured, `orchestrate run` will forward self-contained worker prompts through the bridge and persist returned worker results, synthesis status, and integration status.
- If no bridge is configured, `orchestrate run` keeps the worker launch envelopes, marks synthesis as `manual-workers-required`, and continues with the inline action path.
