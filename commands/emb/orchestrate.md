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
- Current Rust runtime status: orchestration execution is not yet implemented in emb-agent core; use the host's native subagent surface directly when available.
- In Pi, prefer the native `emb_subagent` tool. Active task implementation defaults to `researcher` first when SDK/toolchain/API evidence is missing, then `fw-doer` followed by `release-checker`; add `hw-scout`, `bug-hunter`, `arch-reviewer`, or `sys-reviewer` only when their evidence is needed.
- Use this command doc as a planning contract only until runtime bridge execution is implemented and verified.
- Do not promise that `orchestrate run` will launch host workers automatically in current builds.
