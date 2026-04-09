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

## Default Flow

- Runtime path convention:
  `Codex -> ~/.codex/emb-agent/bin/emb-agent.cjs`
  `Claude Code -> ~/.claude/emb-agent/bin/emb-agent.cjs`
  `runtime-home -> Codex: ~/.codex, Claude Code: ~/.claude`
  The examples below use `<runtime-cli> = node <runtime-home>/emb-agent/bin/emb-agent.cjs`.
- First time in a project:
  `<runtime-cli> init`
  `<runtime-cli> declare hardware --mcu <name> --package <name>`
  `<runtime-cli> next`
- Continuing work:
  `<runtime-cli> next`

## Core Commands

- `$emb-init-project`
  Initialize the current project with emb-agent defaults and truth layers. This is the official initialization flow.
- `$emb-ingest`
  Import external documents or write new facts into project truth.
- `$emb-next`
  Recommend the default next step for the current session.
- `$emb-task`
  Manage task-local execution context once work becomes multi-step.

## Workflow Commands

- `$emb-scan`
  Find entry points, hardware truth, and relevant files before editing.
- `$emb-plan`
  Build a short task-level plan.
- `$emb-do`
  Apply a focused code or documentation change.
- `$emb-debug`
  Narrow the root cause when symptoms are visible but the cause is not.
- `$emb-verify`
  Close work with explicit checks and evidence.
- `$emb-pause`
  Create a lightweight handoff before clearing context.
- `$emb-resume`
  Restore project context after pause or context clearing.

## Hardware And Manual Work

- If the engineer already knows the chip, package, pin map, or peripheral usage, prefer `declare hardware` first.
- If the truth still lives in a PDF or manual, use:
  `<runtime-cli> ingest doc --file <path> --provider mineru --kind datasheet --to hardware`
- If the response already includes `apply_ready`, run it first and then return to `<runtime-cli> next`.

## Advanced Help

- Use `help advanced` or `help --all` to show the full command surface.
- Use `commands list` to inspect every installed public command.
