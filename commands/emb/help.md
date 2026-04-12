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

- Runtime integration:
  Run these as Codex or Claude Code session commands.
  Runtime invocation details are handled by the host integration.
- First time in a project:
  `init`
  `declare hardware --mcu <name> --package <name>`
  `next`
  If hooks or bootstrap seem blocked unexpectedly, run `health` first to inspect workspace trust and truth readiness.
- Continuing work:
  `next`
  `next run` (optional one-step mode: directly enter the recommended stage)
- Process direction:
  `scan` before editing when entry/truth is not explicit
  `plan` when scope or risk is not obvious
  `do/debug` for execution
  `review/verify` for closure
  If project `quality_gates.required_executors` is configured, keep `verify` active until required `executor run <name>` checks pass
  If project `quality_gates.required_signoffs` is configured, the engineer closes them with `verify confirm <name>` or `verify reject <name>`

## Public Commands

The public command surface is intentionally small. Users should only need these 13 commands.
In Codex, this surface is mirrored as skills such as `emb-init`.
In slash-command hosts, the same surface can appear as `$emb-*`.

### Start

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

## Hardware And Manual Work

- If the engineer already knows the chip, package, pin map, or peripheral usage, prefer `declare hardware` first.
- If the truth still lives in a PDF or manual, use:
  `ingest doc --file <path> --provider mineru --kind datasheet --to hardware`
- If the board truth still lives in an Altium schematic or export, use:
  `ingest schematic --file <path>`
- If the response already includes `apply_ready`, run it first and then return to `next`.

## Advanced Help

- Use `help advanced` or `help --all` to show the full command surface.
- Use `commands list` to inspect the installed public command surface.
- Advanced runtime surfaces:
  `skills list`
  `skills show <name>`
  `skills run <name> [--isolated] [input]`
  `memory stack`
  `memory list`
  `memory audit`
- Delegation runtime:
  `dispatch run` and `orchestrate run` can execute through the configured host sub-agent bridge.
  Use `prefs set orchestration_mode <auto|coordinator|fork|swarm>` to steer delegation shape when multi-agent execution is needed.
