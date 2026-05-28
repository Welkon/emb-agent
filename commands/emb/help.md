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

Use this order unless the runtime `next` output says otherwise:

1. `onboard` — first run, partial setup, or existing docs need migration.
2. `next --brief` — default continuation after onboarding.
3. `task add|activate` — create or choose concrete work.
4. `scan -> plan -> do -> review -> verify` — execute and close work.

All installed commands remain available. `init`, `init-project`, `bootstrap`, and `board` are not the normal starting path; use them when `next --brief`, `health`, or the user request calls for that specific function.

## PRD Intake

- Before confirming a system PRD, interrogate the user about product behavior, interactions, defaults, failure/power/reset cases, constraints, and acceptance evidence; do not fill PRD from hardware guesses alone.
- Mirror confirmed structured truth into `.emb-agent/req.yaml` and create child execution PRDs under `docs/prd/features|modules|components|subsystems/*.md` before `prd confirm --create-tasks`.
- If `agent_protocol.gate.kind=prd-exploration`, stop before `prd confirm`, `task add`, `task activate`, `scan`, `plan`, or `do`; ask questions, update PRD/req truth, run `emb-agent validate` or `emb-agent health`, and wait for explicit agreement.
- Before saying the system PRD is complete, show a compact state-machine checklist: boot state, first input, press/release trigger, mode cycle including OFF, long-press valid states, memory semantics, STOP entry, wake source, low-voltage behavior, and acceptance evidence.

## Task Intake

- If the target files and acceptance check are already explicit, use `task add <summary>` and move into `plan` or `next`.
- If requirements, hardware truth, or the changed surface are still unclear, use `task add <summary>` first and let `scan` converge the task before `plan` or `do`.
- After `task add` or PRD-derived task creation, use the generated PRD/task PRD as the convergence point: ask the user about unclear goal, boundary, constraint, acceptance, and open-question items, update the artifact, and repeat until explicit agreement before `scan`, `plan`, or `do`.
- If the change crosses timing, concurrency, release, or interface boundaries, expect the safer path to be `task add -> scan -> plan -> review -> verify`.
- If the request assumes an unconfirmed technical choice, use `decision review` / `decision record` before implementation.
- Capability shortcuts: `scan`, `plan`, `do`, `debug`, `review`, `verify` — equivalent to `capability run <name>`.

## Command Guide

### Start / Continue

- `onboard` — audit or scaffold project truth.
- `next --brief` — ask the runtime what to do now.
- `start --brief` — re-render entry guidance when startup injection was missed.
- `health` — diagnose why startup or `next` looks blocked.

### Work

- `task` — create, inspect, activate, resolve, or close tasks.
- `scan`, `plan`, `do`, `debug`, `review`, `verify` — capability shortcuts for active work.
- `decision` — record explicit choices before implementation.

### Evidence / Memory

- `ingest` — stage datasheets, schematics, or other source evidence.
- `schematic` — query normalized schematic facts.
- `knowledge` — save durable project memory.
- `support` — install or derive chip/tool support only when needed.
## Notes

- If the chip or pin map is already known, prefer `declare hardware` first.
- Once hardware truth is explicit, prefer `bootstrap run --confirm` for the shortest guided bootstrap path.
- Use `next --brief` when a local wrapper only needs compact JSON with summarized runtime signals.
- Use `external start|next|status|health|dispatch-next` when a host or tool needs the stable external-driver envelope.
- Use `task worktree status|show` before `create` or `cleanup` when you need to inspect isolated task workspace state first.
- Prefer project-local chip support first. Use `support bootstrap` only when you explicitly want source-backed install in one step.
- Shared chip-support sources are optional for ordinary project startup; use them when you need reusable support, not before you can begin.
- If the MCU is not chosen yet, keep `hw.yaml` unknown, record constraints in `req.yaml`, then return to `next`.
- If the truth still lives outside `.emb-agent/`, run `onboard` first; it will choose between declaring known hardware, ingesting docs/schematics, or keeping MCU unknown for concept-stage work.
- After `ingest doc`, prefer `adapter analysis init` and then `adapter derive --from-analysis` instead of treating raw documents as final chip support.
- If the chip is known and you only need support for the current project, prefer `adapter derive --from-project` before thinking about shared sources.
- If support is still only valid for the current project, keep it `project-only` first and publish it to a shared adapters catalog only after review.
- When the user confirms real-board behavior (`this build is right`, current draw, wake works/fails), record it with `verify board --result <pass|fail|partial> <summary> --evidence <build/log/measurement> --truth <stable board fact>` instead of leaving it in chat only.

## Specialized Commands

- `init` and `init-project` create low-level scaffold files. Prefer `onboard`; it decides whether initialization is safe.
- `bootstrap` explains dependency ordering. Prefer `next --brief`; use `health` if `next` appears stuck.
- `board` queries parsed PCB layout artifacts. Use it after `ingest board` when PCB layout evidence matters.
- Other installed command docs in this directory are available for narrower runtime, support, or automation work; prefer the fast path unless the task needs them.
- `commands list --all` prints the complete implementation/debugging inventory.