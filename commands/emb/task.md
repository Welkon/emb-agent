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
- Create a task-local `prd.md` so execution starts from an explicit goal, constraints, and closure checklist instead of chat-only state.
- Treat task completion as a protocol: work verified, AAR scanned, and recorded when any new lesson is found.
- Expose task worktrees as a first-class surface through `task worktree list/show/create/cleanup/status`.

## Usage

- Run `$emb-task` when this command matches the current problem.
- Prefer the lightest subcommand that keeps facts, evidence, and project truth aligned.
- Usually `start` should decide when you need `task add` or `task activate`; use `task` directly once the task lifecycle is already explicit.
- Use `task worktree create <name>` when you need the workspace before moving task status to `in_progress`.
- Use `task worktree status` or `task worktree show <name>` to inspect workspace state, registry, and current-task pointers.
- Before `task resolve`, complete `task aar scan`. If any answer is `yes`, complete `task aar record` first.
