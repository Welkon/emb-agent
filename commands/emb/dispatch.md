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
- `dispatch next` carries the `knowledge_graph` summary from `next` so wrappers can refresh stale graph artifacts without changing the resolved action.
- Treat the returned `next_steps` and `agent_protocol` as authoritative. Do not skip gates just because dispatch returns an executable-looking action.
- Current Rust runtime status: dispatch worker execution is not yet implemented in emb-agent core; use the host's native subagent surface directly when available.
- In Pi, prefer the Pi `subagent` tool with generated agents such as `hw-scout`, `bug-hunter`, `fw-doer`, `arch-reviewer`, and `sys-reviewer`.
- **Auto-runner mode** remains a preference contract only until runtime execution is implemented and verified. Do not promise that `dispatch run` will launch host workers automatically in current builds.
