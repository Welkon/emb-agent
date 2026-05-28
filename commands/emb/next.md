---
name: emb-next
description: Recommend the most reasonable next step for the current session.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-next

- Use `$emb-next` after bootstrap and task context are explicit enough to continue.
- Use `next run` when you want the runtime to enter the recommended stage directly.
- If bootstrap still looks stuck before execution, use `health` first.
- Use `next --brief` when a local tool only needs the compact recommendation, action card, next actions, and summarized `runtime_events`.
- Read `knowledge_graph` in JSON output to see whether `.emb-agent/graph/graph.json` is missing, fresh, or stale; stale graphs should be refreshed with `knowledge graph refresh` but do not replace the primary workflow recommendation.
- If an active task already exists, `next` should keep the task `prd.md` in the loop and explicitly tell you whether the right route is `scan-first` or `plan-first`.
- For a new or concept-stage project, `next` should keep `docs/prd/system.md` in the loop before narrowing `.emb-agent/req.yaml` or choosing hardware.
- If `.emb-agent/` is missing, incomplete, or hardware truth is scattered in existing docs, `next` should route to `onboard` before `declare hardware`, `scan`, `plan`, or `do`.
- If `next` returns `agent_protocol.gate.kind=prd-exploration`, ask detailed requirement/behavior questions, update `docs/prd/system.md`, `.emb-agent/req.yaml`, and child execution PRDs, run `emb-agent validate` or `emb-agent health`, then stop until explicit agreement.
- Before declaring PRD exploration complete, show a compact state-machine checklist covering boot state, first input, press/release trigger, mode cycle including OFF, long-press valid states, memory semantics, STOP entry, wake source, low-voltage behavior, and acceptance evidence.
- Use `external next` when the caller wants the stable external-driver protocol with `status`, `summary`, `next.cli`, and summarized `runtime_events`.
- Treat PCB layout evidence as optional. Recommend board ingest only when the current task needs layout, routing, connector, bring-up, or manufacturing evidence; missing PCB files should skip layout checks and keep `can_continue=true`.
- In terminal mode, read the `Events:` line as the shortest explanation of why the runtime recommended the next step.
- If `next` surfaces hardware-document chip-support guidance, the intended path is `adapter analysis init` -> agent fills artifact -> `adapter derive --from-analysis`.
- If the task is a reported bug, prefer `capability run debug` and require a reproducible feedback loop before implementation: failing test, CLI/parser fixture, simulator replay, captured trace replay, serial log script, GPIO pulse + logic analyzer, scope/current-meter measurement, or documented HITL bench step.
- If the task is broad or ambiguous, prefer `task add` or `capability run scan` before `plan` or `do`; after creating PRD/task artifacts, classify the work, draft the agent brief, split large scope into vertical tracer-bullet slices, clarify unclear items with the user until agreement, and keep the result in task/project truth instead of chat-only state.
- If schematic or PCB review raises advice, keep routing non-blocking unless the current task explicitly depends on the affected electrical, layout, bring-up, or manufacturing fact.
