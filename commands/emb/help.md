---
name: emb-help
description: Show the public emb-agent command set and the recommended command flow.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-help

Output the emb-agent command reference below and nothing else.

## Quick Flow

- Runtime path convention:
  `Codex -> ~/.codex/emb-agent/bin/emb-agent.cjs`
  `Claude Code -> ~/.claude/emb-agent/bin/emb-agent.cjs`
  `runtime-home -> Codex: ~/.codex, Claude Code: ~/.claude`
  The examples below use `<runtime-cli> = node <runtime-home>/emb-agent/bin/emb-agent.cjs`.
- First time in a project:
  `<runtime-cli> init`
  `<runtime-cli> declare hardware --mcu <name> --package <name>`
  `<runtime-cli> next`
- Continuing work in the same project:
  `<runtime-cli> next`
- For timer / PWM / ADC / comparator / pin / register / manual-triage problems:
  Check `next.tool_recommendation` first.
  Then check `dispatch next` / `orchestrate` for `tool_execution`.
  If `tool_execution.status = ready`, run the suggested `tool run ...` first.
- For manual or PDF import:
  `<runtime-cli> ingest doc --file <path> --provider mineru --kind datasheet --to hardware`
  If the response already includes `apply_ready`, run it first and then return to `<runtime-cli> next`.

## Public Commands

- `$emb-adapter`
  Manage adapter sources, discovery, derivation, and quality status.
- `$emb-arch-review`
  Run an explicit heavyweight architecture review.
- `$emb-debug`
  Narrow root causes when symptoms are known but the root cause is not.
- `$emb-dispatch`
  Convert the current action into a lightweight dispatch contract.
- `$emb-do`
  Apply the smallest direct code or documentation change.
- `$emb-executor`
  Run executor actions and summarize the latest execution result.
- `$emb-forensics`
  Collect evidence when flow, handoff, or context has drifted.
- `$emb-health`
  Check whether project truth, adapters, session state, and cache are healthy.
- `$emb-help`
  Show the public emb-agent command set and the recommended command flow.
- `$emb-ingest`
  Write new facts into truth files or import external documents.
- `$emb-init-project`
  Initialize the current project with emb-agent defaults and truth layers. This is the official initialization flow.
- `$emb-manager`
  Summarize the best next operational actions for the current project.
- `$emb-next`
  Recommend the most reasonable next step for the current session.
- `$emb-note`
  Record durable conclusions into project documentation.
- `$emb-orchestrate`
  Merge next, dispatch, and context-hygiene signals into one orchestrator contract.
- `$emb-pause`
  Create a lightweight handoff before clearing context.
- `$emb-plan`
  Generate a short task-level micro-plan.
- `$emb-prefs`
  Inspect or change embedded workflow preferences.
- `$emb-resume`
  Restore project context after pause or context clearing.
- `$emb-review`
  Perform structural review for systems, release paths, or concurrency boundaries.
- `$emb-scan`
  Locate code entry points, hardware truth, and relevant files.
- `$emb-session-report`
  Write a lightweight report for the current session.
- `$emb-settings`
  Inspect or change emb-agent runtime settings.
- `$emb-spec`
  Manage reusable project-local specifications.
- `$emb-task`
  Manage task-local context tied to a precise file set.
- `$emb-template`
  Inspect and fill built-in documentation or registry templates.
- `$emb-thread`
  Track a long-lived technical thread without creating a heavy plan.
- `$emb-tool`
  Inspect, recommend, and run abstract tool calculations.
- `$emb-update`
  Check installed runtime version and update status.
- `$emb-verify`
  Close implementation work with verification targets, evidence, and results.
- `$emb-workspace`
  Manage long-lived visible work surfaces inside the project.

## Execution Signals

For `scan / plan / do / debug / review / verify / note`, runtime output includes:

- `agent_execution`
  Tells the caller whether to stay inline or call installed `emb-*` agents, who the recommended primary/supporting agents are, and whether fan-out is justified.
- `dispatch_contract`
  Tells the caller when to launch sub-agents, what context to pass, and who owns integration.

For `next / dispatch next / orchestrate`, when emb-agent has already identified a runnable hardware tool, output also includes:

- `tool_recommendation`
- `tool_execution`

For `manager / dispatch next / orchestrate / session-report`, if a recent executor result exists, read these fields first:

- `executor_signal`
  Prefer the structured signal over free-form reasoning text.
- `diagnostics.latest_executor`
  Use this only when the raw recent execution summary is needed.
