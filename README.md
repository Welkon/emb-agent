# emb-agent

A lightweight workflow for embedded firmware projects.

emb-agent helps AI-assisted firmware work stay grounded in hardware truth. It is built for projects where datasheets, registers, timing limits, pin mappings, board constraints, and verification matter as much as source code.

Instead of forcing every task into a heavy planning system, emb-agent keeps the workflow small. You store durable facts in project truth files, start from a short default command flow, and only reach for more specific commands when the task actually needs them.

It fits the kind of work that usually becomes messy in normal AI coding loops: brownfield MCU repositories, vendor SDK projects, register-level debugging, peripheral formulas, hardware bring-up, and tasks that need context to survive across long sessions.

## Why People Use It

- Keep confirmed hardware and requirement facts in visible project files instead of repeating them in every session.
- Start with one default command, `next`, instead of memorizing a large workflow up front.
- Let formula-heavy or register-heavy tasks surface structured tool guidance when a calculation or adapter is available.
- Preserve momentum across context resets with lightweight handoff commands instead of rebuilding context from scratch.

## Quick Start

You do not need to learn every command on day one.

For most projects, the shortest useful path is:

1. Install emb-agent into your host runtime.
1. Run `init` once in the project.
1. Use `next` as the default entry point.
1. If the task is formula-, peripheral-, or register-heavy, check `dispatch next` or `orchestrate` for structured tool guidance.
1. If the session gets noisy, use `pause` -> clear context -> `resume`.

## Recommended Flow

If you are new to emb-agent, follow this order before reaching for specialized commands:

1. `init`
   Run once when a repository has not been prepared for emb-agent yet.
1. `next`
   Start here for almost every normal task. If you only remember one command, remember this one.
1. `dispatch next` or `orchestrate`
   Use these when you need structured routing, tool execution, or execution signals instead of a simple recommendation.
1. `pause` -> clear context -> `resume`
   Use this when the session is getting noisy, long, or fragmented.

## When To Use Which Command

- Use `next` when you want the default next step and do not want to choose a command yourself.
- Use `scan` when you first need entry points, related files, hardware truth, or code locations.
- Use `plan` when the task needs a small execution plan before you touch code or docs.
- Use `do` when you already know the exact change to make and just want to apply it.
- Use `debug` when the symptom is visible but the root cause is still unclear.
- Use `review` when you want design or structure feedback rather than implementation.
- Use `verify` when the work is done and you want explicit checks, evidence, and closure.
- Use `note` when a conclusion should become durable project knowledge.
- Use `ingest` when a datasheet, manual, PDF, or external note should be turned into project truth.
- Use `tool` when you already know you need a calculation or hardware helper tool.
- Use `dispatch next` when `next` is not enough and you want a lightweight execution contract.
- Use `orchestrate` when you want next-step guidance, dispatch, and context hygiene merged into one answer.
- Use `manager` when you need project-level operational direction instead of only the next task step.
- Use `executor` when you want to run an executor action or inspect the latest execution result.
- Use `health` when adapters, truth files, runtime state, or cache may be out of sync.
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
