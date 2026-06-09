# GEMINI.md
<!-- EMB-AGENT:START -->
## Quick Routing

{{INCLUDE:_partials/quick-routing-table.md}}

## Auto Triggers

{{INCLUDE:_partials/auto-trigger-closure.md}}
{{INCLUDE:_partials/auto-trigger-load-bearing.md}}
- On a fresh Gemini session, re-enter through this file before trusting prior context.

## Red Flags - STOP

{{INCLUDE:_partials/red-flags-stop.md}}

## Human-Readable Defaults

- Keep guidance hardware-first and name the real blocker.
- Give the exact next command or file before adding extra structure.
- Treat skills, hooks, extensions, and wrappers as integration surfaces; they must not override emb-agent runtime gates.
- Avoid generic AI or project-management wording when a concrete board action, artifact, or truth file is known.

{{LANGUAGE_INSTRUCTION}}

## Gemini Notes

- Use installed emb-agent project truth and host skills; do not expect runtime scaffold folders in the host install.
- Do not add project-specific defaults here without passing the anti-template test.
- The template should remember harness infrastructure so the skill author can focus on project truth.
- Treat `agent_protocol.gate` fields from emb-agent JSON as authoritative; execute allowed host actions yourself and never ask the user to run emb-agent commands manually.
- After editing `.emb-agent/hw.yaml`, `.emb-agent/req.yaml`, or `docs/prd/*.md`, run the installed runtime's `validate` or `health` command before saying PRD/truth is complete.
- For PRD exploration, confirm a compact state-machine checklist before implementation: boot state, first input, press vs release trigger, mode cycle including OFF, long-press valid states, memory semantics, STOP entry, wake source, low-voltage behavior, acceptance evidence, and if waveform or measurement captures exist, extract exact timings/percentages/slopes from them before declaring requirements complete.
- When only dispatching tools with no conversational reply, do not emit a "." filler. Send tool calls as the turn's sole content.
- For tasks, classify work as bug, feature, board-bringup, power, timing, or toolchain; require a durable agent brief before activation: current behavior, desired behavior, hardware facts, firmware interfaces, acceptance criteria, out-of-scope, and required verification.
- Split large work into vertical tracer-bullet slices. Each slice must be independently verifiable across firmware, hardware truth, docs, and verification surfaces; avoid horizontal layer tasks.
- For bugs, build a feedback loop before mutation: failing test, CLI/parser fixture, simulator replay, captured trace, serial log, GPIO pulse + logic analyzer, scope/current-meter measurement, or documented HITL bench step.
<!-- EMB-AGENT:END -->
