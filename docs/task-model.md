# Task Model

emb-agent tasks are meant for work that is no longer just a one-shot command.

Task manifests live under:

```text
.emb-agent/tasks/<task-name>/task.json
```

## Purpose

The task model gives longer work a durable structure:

- ownership
- lifecycle
- branch context
- related files
- next action phases

This is the layer between short interactive work and full project management tooling.

## Current manifest shape

The current schema is published in:

- `runtime/schemas/task.schema.json`

The default scaffold source is published in:

- `runtime/templates/task.json.tpl`

Key fields include:

- `id`
  Task ID in `MM-DD-slug` form
- `name`
  Task slug
- `title`
  Human-readable task title
- `description`
  Task description and boundary
- `status`
  `planning | in_progress | review | completed | rejected`
- `dev_type`
  `backend | frontend | fullstack | test | docs | embedded`
- `scope`
  Commit scope or work area
- `priority`
  `P0 | P1 | P2 | P3`
- `creator`
  Task creator
- `assignee`
  Current owner
- `branch`
  Feature branch name
- `base_branch`
  Intended merge target
- `current_phase`
  Current workflow phase number
- `next_action`
  Ordered phase list such as `implement -> check -> finish -> create-pr`
- `relatedFiles`
  Files currently tied to the task
- `notes`
  Freeform task notes

## Typical flow

```text
task add -> task activate -> task context add -> task aar scan -> task aar record? -> task resolve
```

Worktree operations are now available as a first-class companion flow:

```text
task worktree list
task worktree status [task-name]
task worktree show <task-name>
task worktree create <task-name>
task worktree cleanup <task-name>
```

`task activate` and `task resolve` still create and cleanup the task workspace automatically, but the worktree lifecycle can now be managed independently when you need Trellis-style inspection or pre-provisioning.

Example:

```bash
<runtime-cli> task add "Implement TM2 PWM support" --scope pwm --priority P1 --assignee welkon
<runtime-cli> task activate implement-tm2-pwm-support
<runtime-cli> task context add implement-tm2-pwm-support implement src/timer.c "TM2 implementation file"
<runtime-cli> task aar scan implement-tm2-pwm-support --aar-new-pattern no --aar-new-trap no --aar-missing-rule no --aar-outdated-rule no
<runtime-cli> task resolve implement-tm2-pwm-support "chip support merged"
```

If any AAR answer is `yes`, insert `task aar record <task> --aar-summary ... --aar-detail ...` before `task resolve`.

## Shared vs runtime concerns

Tasks are repository-visible project artifacts.

That makes them different from:

- runtime handoffs
- host install metadata
- personal session continuity

Tasks are intended to be inspectable as part of the project’s shared execution state.
