---
name: emb-start
description: Summarize project truth, task state, and the shortest default workflow to continue.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-start

## Purpose

- Give the agent one linear entrypoint for the current repository.
- Summarize bootstrap state, active task state, and the immediate next command without forcing the agent to infer the workflow from many separate commands.

## Usage

- Run `$emb-start` at the beginning of a session or after a major context switch.
- Prefer it over manually guessing whether to call `init`, `next`, `task add`, `task activate`, or `resume`.

## What Start Should Do

- If the repository is not initialized, route to `init`.
- If project truth is still incomplete, route to the shortest bootstrap step and then back to `next`.
- If an unconsumed handoff exists, route to `resume` first.
- If bootstrap is already closed and there is no active task, route to `task add` and `task activate`.
- If an active task already exists, restate the default loop:
  `next -> do/debug -> verify -> task aar scan -> task resolve`
