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
- Track parent/child relationships and branch / base-branch metadata so a task can close into a PR-ready handoff instead of ending as isolated local state.
- Create a task-local `prd.md` so execution starts from an explicit goal, constraints, and closure checklist instead of chat-only state.
- Treat task completion as a protocol: work verified, AAR scanned, and recorded when any new lesson is found.
- Expose task worktrees as a first-class surface through `task worktree list/show/create/cleanup/status`.

## Usage

- Run `$emb-task` when this command matches the current problem.
- Prefer the lightest subcommand that keeps facts, evidence, and project truth aligned.
- Usually `start` should decide when you need `task add` or `task activate`; use `task` directly once the task lifecycle is already explicit.
- If the change surface is still unclear, create the task first so `prd.md` exists, then use `scan` to converge scope before `plan` or `do`.
- After `task add`, treat the generated `prd.md` as the lightweight convergence point: lock goal, constraints, acceptance, and open questions before deciding whether the next command is `scan` or `plan`.
- After `task activate`, keep the same PRD in the loop instead of jumping straight into mutation; if the task still drifts, run `scan` first, otherwise move into `plan`.
- Use `task add --parent <name>` or `task subtask add <parent> <child>` when larger work needs a visible task tree.
- In monorepo projects, use `task add --package <name>` to bind the task to one package and carry that package into activation and status.
- Package-bound tasks automatically prioritize that package in their default context and expose package scope in `task worktree show/status`.
- Use `task set-branch` and `task set-base-branch` before `task create-pr` if branch routing needs to differ from the defaults.
- Use `task link-pr <name> <url>` after creating the PR manually so the task and worktree state stay PR-aware instead of stopping at preview-only metadata.
- Use `task worktree create <name>` when you need the workspace before moving task status to `in_progress`.
- Use `task worktree status` or `task worktree show <name>` to inspect workspace state, registry, current-task pointers, package submodule metadata, and PR readiness.
- Prefer `task worktree status` or `task worktree show <name>` before `create` or `cleanup`; they expose `workspace_state`, `attention`, and a plain-language summary for the operator.
- Before `task resolve`, complete `task aar scan`. If any answer is `yes`, complete `task aar record` first.
