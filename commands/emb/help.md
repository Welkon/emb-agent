---
name: emb-help
description: Show the emb-agent command flow, starting from the shortest onboarding path.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-help

Output the emb-agent help summary below and nothing else.

## Fast Path

- Run these as Codex, Claude Code, or Cursor session commands.
- Use `start` first. It is the single repository entrypoint and tells you whether to `resume`, `task add`, `declare hardware`, `next`, or repair with `init`.
- Treat `init` as a manual bootstrap or recovery command, not the default first step after a local install.
- Use `next` for the default continuation once project truth and task context are in place.
- Use `help advanced` or `help --all` only when you need the full installed surface.

## Public Commands

The public command surface is intentionally small. Users should only need these 14 commands.
In Codex, this surface is mirrored as skills such as `emb-init`.
In slash-command hosts, the same surface can appear as `$emb-*`.

### Start

- `$emb-start`
  Summarize the current project/task state and return the shortest default workflow to continue.
- `$emb-init`
  Initialize the current project with emb-agent defaults and truth layers. This is the official initialization flow.
- `$emb-ingest`
  Import external documents or write new facts into project truth.
- `$emb-next`
  Recommend the default next step for the current session. Use `next run` when you want to enter that step directly.
- `$emb-task`
  Manage task-local execution context once work becomes multi-step.

### Execute

- `$emb-scan`
  Find entry points, hardware truth, and relevant files before editing.
- `$emb-plan`
  Build a short task-level plan.
- `$emb-do`
  Apply a focused code or documentation change.
- `$emb-debug`
  Narrow the root cause when symptoms are visible but the cause is not.

### Close

- `$emb-review`
  Review the change before closure when structural risk is non-trivial.
- `$emb-verify`
  Close work with explicit checks and evidence.
- `$emb-pause`
  Create a lightweight handoff before clearing context.
- `$emb-resume`
  Restore project context after pause or context clearing.

## Notes

- If the engineer already knows the chip, package, pin map, or peripheral usage, prefer `declare hardware` first.
- If the MCU is not chosen yet, do not guess. Keep `hw.yaml` unknown, record product constraints in `req.yaml`, and let `next` stay on the concept-stage path.
- If the truth still lives outside the repo, use `ingest doc`, `ingest schematic`, `doc lookup`, or `component lookup` to collect evidence before writing project truth.
- `declare hardware` writes truth directly; document and schematic intake stay evidence-first and should return to `next` after review or apply.

## Advanced Help

- Use `help advanced` or `help --all` to show the full command surface.
- Use `commands list` to inspect the default public command surface.
- Use `commands list --all` when you explicitly want the full installed command inventory.
- Embedded workflow support surfaces:
  `skills list`
  `skills show <name>`
  `skills run <name> [--isolated] [input]`
  `memory stack`
  `memory list`
  `memory audit`
- Delegation runtime:
  `dispatch run` and `orchestrate run` can execute through the configured host sub-agent bridge.
  Use `prefs set orchestration_mode <auto|coordinator|fork|swarm>` to steer delegation shape when multi-agent execution is needed.
- Authoring surfaces:
  `scaffold list`
  `scaffold show <name>`
  `scaffold install <name> [output] [--force] [KEY=VALUE ...]`
  `workflow ...`
  These are for skill, shell, hook, and protocol maintenance in service of the embedded workflow. They are not part of the default firmware-project path.
