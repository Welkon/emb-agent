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
  Run these as Codex, Claude Code, or Cursor session commands.
  Runtime invocation details are handled by the host integration.
- First time in a project:
  `init`
  If MCU/package are already known:
  `declare hardware --mcu <name> --package <name>`
  If MCU/package are still unknown:
  keep `.emb-agent/hw.yaml` unknown, record goals and constraints in `.emb-agent/req.yaml`, then continue
  `next`
  If automatic bootstrap seems blocked unexpectedly, run `health` first to inspect host readiness and truth readiness.
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
- If the MCU is not chosen yet, do not guess. Keep `hw.yaml` unknown, record product constraints in `req.yaml`, and let `next` stay on the concept-stage path.
- If the truth still lives in a PDF or manual, use:
  `ingest doc --file <path> --provider mineru --kind datasheet --to hardware`
- If the chip is known but the PDF is still missing, use:
  `doc lookup --chip <name> --vendor <name>`
- If a schematic already carries datasheet links, use:
  `doc lookup --file <schematic> --ref <designator>`
- If the board truth still lives in an Altium schematic or export, use:
  `ingest schematic --file <path>`
- `declare hardware` writes `hw.yaml` directly and returns `write_mode: truth-write`.
- `ingest doc` returns `write_mode: staged-truth` when the parsed document can be applied into `hw.yaml` or `req.yaml`; use `apply_ready` to move from parsed evidence to truth.
- After `ingest schematic`, let the agent analyze the normalized `parsed.json` / hardware draft first; do not copy inferred controller or signals straight into `hw.yaml`.
- `ingest schematic` returns `write_mode: analysis-only`, `truth_write.direct: false`, and `apply_ready: null` to make that deferred handoff explicit.
- If you want normalized supplier-search inputs from a schematic, use:
  `component lookup --file <schematic>`
- If you want explicit supplier candidates from 立创商城, use:
  `component lookup --file <schematic> --provider szlcsc`
- `doc lookup` and `component lookup` return `result_mode: candidate-only`; they help collect evidence, not write project truth.
- If the response already includes `apply_ready`, run it first and then return to `next`.

## Advanced Help

- If you are just trying to move an embedded project forward, you can usually stop before this section.
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
