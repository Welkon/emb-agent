# emb-agent

A lightweight agent framework for embedded projects.

emb-agent is designed for firmware work where hardware truth, timing, register behavior, datasheets, and board constraints matter as much as code. The framework stays intentionally light: it uses truth files, short command flows, adapter-based chip extensions, and context handoff instead of forcing every task through a heavy planning system.

## Quick Start

Install emb-agent into your host runtime, initialize the current project, and then use `next` as the default entry point. For hardware-formula or register-triage problems, prefer `next`, `dispatch next`, or `orchestrate` so the runtime can expose `tool_recommendation` and `tool_execution`. When context grows heavy, use `pause -> clear -> resume`.

## Recommended Flow

If you are new to emb-agent, use this order first:

1. `init`
   Run once when a repository has not been prepared for emb-agent yet.
1. `next`
   Start here for almost every normal task. It tells you the most reasonable next move.
1. `dispatch next` or `orchestrate`
   Use these when you need structured routing, tool execution, or execution signals instead of a simple recommendation.
1. `pause` -> clear context -> `resume`
   Use this when the session is getting noisy, long, or fragmented.

## When To Use Which Command

- Use `next` when you do not want to think about command choice and just need the default next step.
- Use `scan` when you need entry points, related files, hardware truth, or code locations before acting.
- Use `plan` when the task is real but still small enough for a short micro-plan.
- Use `do` when you already know the exact code or document change to make.
- Use `debug` when the symptom is clear but the root cause is not.
- Use `review` when you want a structural or design review instead of implementation.
- Use `verify` when implementation is done and you need explicit checks, evidence, and closure.
- Use `note` when conclusions should become durable project knowledge.
- Use `ingest` when a datasheet, manual, PDF, or external note needs to become project truth.
- Use `tool` when you already know you need a calculation or hardware helper tool.
- Use `dispatch next` when `next` is not enough and you want a lightweight execution contract.
- Use `orchestrate` when you want one merged answer that combines next-step guidance, dispatch, and context hygiene.
- Use `manager` when you need project-level operational direction rather than just the next task step.
- Use `executor` when you want to run an executor action or inspect the most recent execution result.
- Use `health` when the runtime, truth files, adapters, or cache may be out of sync.
- Use `pause` and `resume` when you need to preserve handoff state across context clears.
- Use `spec`, `template`, `workspace`, or `task` when you are maintaining reusable project structure rather than solving a single task.

## Common Examples

- New repository or first-time setup:
  `init` -> `next`
- Unsure what to do next:
  `next`
- Need code entry points before editing:
  `scan`
- Need a small implementation change:
  `do`
- Need root-cause analysis:
  `debug`
- Need timer / PWM / ADC / comparator / pin / register help:
  `next`, then `dispatch next` or `orchestrate` if a tool should run
- Need to import a datasheet or manual:
  `ingest`
- Need a final check before closing work:
  `verify`

## Core Ideas

- Keep project truth in `./.emb-agent/hw.yaml` and `./.emb-agent/req.yaml`.
- Use `ingest` and document apply flows to convert raw manuals into durable facts.
- Use adapters to hold chip-, family-, and device-specific formulas or register boundaries.
- Use lightweight commands such as `scan`, `plan`, `do`, `debug`, `review`, and `verify` only when the problem actually needs them.
- Let `manager`, `dispatch`, `orchestrate`, and `session-report` surface structured execution signals instead of relying on free-form text.

## Runtime Layout

The installed runtime lives under the host configuration directory. Project-local long-lived assets stay visible in the repository under `./.emb-agent/` and `./docs/`. Runtime state such as sessions, handoffs, and locks stays under the host runtime state directory.

## Adapter Model

emb-agent core stays abstract on purpose. The core defines command flow, session state, templates, and tool contracts. Vendor- or chip-specific formulas, bindings, and execution logic belong in external adapters. Trust is evaluated from the full evidence chain: profiles, bindings, register summaries, component references, runtime implementation state, and recent project context.

## Command Reference

See [commands/emb/help.md](./commands/emb/help.md) for the public command set.

## Release Notes

See [RELEASE.md](./RELEASE.md).
