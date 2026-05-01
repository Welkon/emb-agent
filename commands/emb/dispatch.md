---
name: emb-dispatch
description: Convert the current action into a lightweight dispatch contract.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-dispatch

## Purpose

- Convert the current action into a lightweight dispatch contract.

## Usage

- Run `$emb-dispatch` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- Use `dispatch run next` or `dispatch run <action>` in runtime CLI when you want to execute the resolved dispatch target immediately.
- `dispatch next` carries the `knowledge_graph` summary from `next` so wrappers can refresh stale graph artifacts without changing the resolved action.
- Use `prefs set orchestration_mode <auto|coordinator|fork|swarm>` when the session should prefer a coordinator chain, inherited-context fork workers, or a flat swarm roster.
- Codex installs include a bundled stdio bridge, so dispatch can launch host workers without extra `EMB_AGENT_SUBAGENT_BRIDGE_CMD` setup after install.
- If host sub-agent bridge support is configured, `dispatch run` also emits self-contained worker launch envelopes and records returned worker results in session diagnostics.
- If no bridge is configured, `dispatch run` keeps the worker launch envelopes, marks synthesis as `manual-workers-required`, and continues with the inline action path.
