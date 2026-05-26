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
- Treat `docs/prd/system.md` as the parent contract for every task PRD; task-local structure or architecture changes should justify why the system shape is changing.
- Treat task completion as a protocol: work verified, AAR scanned, and recorded when any new lesson is found.
- Expose task worktrees as a first-class surface through `task worktree list/show/create/cleanup/status`.

## Usage

- Run `$emb-task` when this command matches the current problem.
- Prefer the lightest subcommand that keeps facts, evidence, and project truth aligned.
- Usually `start` should decide when you need `task add` or `task activate`; use `task` directly once the task lifecycle is already explicit.
- If the change surface is still unclear, create the task first so `prd.md` exists, then use `capability run scan` to converge scope before `capability run plan` or `capability run do`.
- After `task add`, treat the generated `prd.md` as the lightweight convergence point: discuss unclear goal, boundary, constraint, acceptance, and open-question items with the user until explicit agreement before deciding whether the next capability is `scan` or `plan`.
- When converting conversation into a task, synthesize what is already known first. Ask only for missing load-bearing decisions, and prefer reading project files, the active variant truth (`.emb-agent/variants/<active>/hw.yaml` and `req.yaml` when `.emb-agent/active-variant` exists; otherwise root `.emb-agent/hw.yaml` and `req.yaml`), schematics, PCB artifacts, manuals, and task context over interviewing the user.
- For large work, split into task/subtask vertical slices: each slice should produce a narrow but complete, verifiable path through the relevant firmware, hardware truth, support, documentation, and verification surfaces.
- Mark slices that need human judgment, bench access, part selection, or schematic/layout acceptance as human-gated instead of pretending they are agent-ready.
- After `task activate`, keep the same PRD in the loop and continue in the main workspace by default; if the task still drifts, run `capability run scan` first, otherwise move into `capability run plan`.
- Use `task add --parent <name>` or `task subtask add <parent> <child>` when larger work needs a visible task tree.
- In monorepo projects, use `task add --package <name>` to bind the task to one package and carry that package into activation and status.
- Package-bound tasks automatically prioritize that package in their default context and expose package scope in `task worktree show/status`.
- Use `task set-branch` and `task set-base-branch` before `task create-pr` if branch routing needs to differ from the defaults.
- Use `task link-pr <name> <url>` after creating the PR manually so the task and worktree state stay PR-aware instead of stopping at preview-only metadata.
- Use `task activate --worktree <name>` or `task worktree create <name>` only when isolated execution is needed; normal firmware work should stay in the main project workspace.
- Use `task worktree status` or `task worktree show <name>` to inspect workspace state, registry, current-task pointers, package submodule metadata, and PR readiness.
- Prefer `task worktree status` or `task worktree show <name>` before `create` or `cleanup`; they expose `workspace_state`, `attention`, and a plain-language summary for the operator.
- During debugging tasks, require a feedback loop before mutation when practical: failing test, CLI fixture, parser fixture, captured trace, simulator run, bench step, or a clearly documented non-reproducible gap.
- Before `task resolve`, complete `task aar scan`. If any answer is `yes`, complete `task aar record` first.

### Trace and Insight Integration

- **After implement**: run `trace record` to log changed files, referenced specs, and key decisions.
- **After check**: append review outcome and discovered pitfalls to the trace.
- **After finish-work**: run `trace record` with final commit and reviewer, then `insight extract --confirm` to push durable learnings (decisions, pitfalls, invariants) into `.emb-agent/wiki/`.
- Trace entries are append-only. Insights are written as wiki pages linked back to the task.
- In auto-runner mode, trace recording and insight extraction happen automatically at each phase boundary.
