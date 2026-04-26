# Automation Output Contract

This document defines the emb-agent surfaces intended for wrappers, host runtimes, and lightweight automation.

The goal is not to freeze every internal payload forever. The goal is to make clear which output surfaces are intentionally stable enough to integrate against.

## Contract Scope

Prefer these surfaces in this order:

1. `--brief`
   Compact JSON for local wrappers that need the next action, current status, or closure summary without the full internal payload.
2. `external <start|status|next|health|dispatch-next>`
   Stable envelope for host runtimes, skills, MCP-style bridges, or other external drivers.
3. `task worktree list|status|show|create|cleanup`
   Stable JSON for isolated task workspace inspection and lifecycle management.

Do not parse human-facing full JSON or terminal text if one of the surfaces above already fits the need.

## Stability Rules

- Fields documented here are the integration contract.
- New fields may be added without a breaking change.
- Existing documented fields should not change meaning silently.
- Human-facing terminal output is convenience only.
- Terminal output may change wording, but when runtime events exist it should still expose an `Events:` summary line in TTY mode.

## Runtime Event Summary Contract

`--brief` and `external` do not expose the raw `runtime_events` array. They expose a summarized object.

Guaranteed fields:

- `status`
  One of `clear | ok | pending | blocked | failed`
- `total`
  Total summarized event count
- `blocked`
  Count of blocked events
- `pending`
  Count of pending events
- `failed`
  Count of failed events

Optional fields:

- `types`
  Present only when non-empty
- `categories`
  Present only when non-empty
- `summaries`
  Present only when non-empty

Meaning:

- `clear`
  No active runtime signal is being surfaced
- `ok`
  Informational signal only
- `pending`
  Follow-up is still recommended
- `blocked`
  Execution should pause until the blocker is closed
- `failed`
  A failed step or failed runtime signal was observed

## Brief Mode Contract

Entry rule:

- Output always includes `"output_mode": "brief"`

Common guarantees:

- `runtime_events` is always a summary object, not a raw event array
- command-specific payload is compact and action-oriented
- internal expansion fields that only exist for full JSON should stay omitted

Typical `next --brief` contract:

```json
{
  "output_mode": "brief",
  "current": {
    "profile": "baremetal-8bit"
  },
  "next": {
    "command": "scan",
    "reason": "Project is still in definition and chip-selection mode.",
    "cli": "node ~/.codex/emb-agent/bin/emb-agent.cjs capability run scan"
  },
  "capability_route": {
    "capability": "scan",
    "route_strategy": "capability-first"
  },
  "workflow_stage": {
    "name": "selection",
    "primary_command": "scan"
  },
  "task_convergence": {
    "recommended_path": "scan-first",
    "prd_path": ".emb-agent/tasks/<task>/prd.md"
  },
  "action_card": {
    "stage": "selection",
    "first_cli": "node ~/.codex/emb-agent/bin/emb-agent.cjs capability run scan"
  },
  "next_actions": [
    "Suggested flow: capability run scan -> capability run do -> capability run verify"
  ],
  "runtime_events": {
    "status": "pending",
    "total": 1,
    "types": ["workflow-next"]
  }
}
```

Good case:

- wrapper needs only the next command and short explanation

Base case:

- wrapper needs to render one compact card plus follow-up commands

Optional active-task hint:

- `task_convergence`
  Present when `next` is explicitly routing an active task back through its PRD before execution. Use it to surface `scan-first` vs `plan-first` and the task PRD path without parsing terminal text.

Bad case:

- wrapper parses human terminal text instead of `--brief`

## External Protocol Contract

Entry rule:

- Output always includes `"protocol": "emb-agent.external/1"`

Guaranteed envelope fields:

- `protocol`
- `entrypoint`
- `runtime_cli`
- `status`
- `summary`
- `runtime_events`
- `next`

Supported entrypoints:

- `start`
- `init`
- `next`
- `status`
- `health`
- `dispatch-next`

Notes:

- `runtime_events` is a summary object, not the raw event array
- `next` is the driver handoff object
- each entrypoint may add a small number of stable supporting fields such as `session_state` or `blocking_checks`

Typical external `next` contract:

```json
{
  "protocol": "emb-agent.external/1",
  "entrypoint": "next",
  "runtime_cli": "node ~/.codex/emb-agent/bin/emb-agent.cjs",
  "status": "selection",
  "summary": "Project is still in definition and chip-selection mode.",
  "runtime_events": {
    "status": "pending",
    "total": 1
  },
  "next": {
    "cli": "node ~/.codex/emb-agent/bin/emb-agent.cjs capability run scan"
  }
}
```

Good case:

- host runtime needs one stable machine-readable handoff

Base case:

- external skill needs a summary plus one recommended CLI

Bad case:

- external caller expects full internal workflow state or raw runtime events

## Task Worktree Contract

These commands expose task workspace lifecycle as a first-class JSON surface.

### `task worktree list`

Guaranteed fields:

- `worktrees`
- `summary`
- `registry_path`
- `runtime_events`

`summary` includes:

- `total`
- `active`
- `missing`
- `dirty`
- `attention_required`

### `task worktree status <name>` and `task worktree show <name>`

Guaranteed fields:

- `worktree`
- `task`
- `runtime_events`

`worktree` includes:

- `task_name`
- `mode`
- `path`
- `exists`
- `managed`
- `active`
- `current_task`
- `dirty_files`
- `workspace_state`
- `attention`
- `summary`

`workspace_state` is expected to be one of:

- `detached`
- `missing`
- `external`
- `dirty`
- `misaligned`
- `active`
- `ready`

### `task worktree create <name>`

Guaranteed fields:

- `created`
- `task`
- `workspace`
- `worktree`
- `runtime_events`

### `task worktree cleanup <name>`

Guaranteed fields:

- `cleaned`
- `task`
- `workspace_cleanup`
- `runtime_events`

Good case:

- wrapper decides whether to provision, inspect, or clean a task workspace

Base case:

- operator needs to know whether the workspace is dirty, missing, detached, or active

Bad case:

- wrapper infers workspace state from filesystem layout alone without using `task worktree`

## Text Mode Contract

TTY output is for humans first.

Machine callers should not parse terminal text if `--brief`, `external`, or task-worktree JSON already fits.

Current user-facing expectation:

- text-mode `next` should summarize the recommended action
- text-mode `task worktree` should summarize task, state, and summary when applicable
- when runtime events are present, TTY output should expose an `Events:` line

## Validation Matrix

- `tests/output-mode.test.cjs`
  Validates compact `--brief` behavior and runtime event summaries
- `tests/external-driver.test.cjs`
  Validates `external` protocol shape
- `tests/task.test.cjs`
  Validates task worktree JSON lifecycle
- `tests/command-visibility.test.cjs`
  Validates user-facing TTY summary behavior
