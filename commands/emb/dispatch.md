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
- `codex.dispatch_mode: inline` keeps dispatch contract-only.
- `codex.dispatch_mode: auto` recommends native Codex subagent prompts for broad, high-risk, or research-heavy embedded work while preserving inline fallback; SDK/toolchain/API implementation jobs use `researcher` before `fw-doer` followed by `release-checker`.
- `codex.dispatch_mode: sub-agent` returns a native Codex subagent prompt contract and requires host-native delegation when the current Codex surface exposes subagents.
- `dispatch next` carries the `knowledge_graph` summary from `next` so wrappers can refresh stale graph artifacts without changing the resolved action.
- Use `prefs set orchestration_mode <auto|coordinator|fork|swarm>` when the session should prefer a coordinator chain, inherited-context fork workers, or a flat swarm roster.
- **Auto-runner mode**: `prefs set auto_runner true` — automatically chains task phases (implement → check → finish-work → next task) without manual per-phase confirmation. Stops on review failure, human-gated task, user interrupt, or `prefs set auto_runner false`.
- Codex installs include a bundled stdio bridge, so dispatch can launch host workers without extra `EMB_AGENT_SUBAGENT_BRIDGE_CMD` setup after install.
- `dispatch run` returns a self-contained delegation contract for the active Codex session; it does not launch `codex exec` as a substitute for native subagents.
