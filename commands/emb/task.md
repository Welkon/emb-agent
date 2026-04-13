---
name: emb-task
description: Manage task-local context tied to a precise file set.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-task

## Purpose

- Manage task-local context tied to a precise file set.
- Persist task manifests under `.emb-agent/tasks/<name>/task.json` with status, owner, priority, branch context, and related files.
- Treat task completion as a protocol: work verified, AAR scanned, and recorded when any new lesson is found.

## Usage

- Run `$emb-task` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- Before `task resolve`, complete `task aar scan`. If any answer is `yes`, complete `task aar record` first.
