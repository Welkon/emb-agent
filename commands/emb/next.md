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
- If an active task already exists, `next` should keep the task `prd.md` in the loop and explicitly tell you whether the right route is `scan-first` or `plan-first`.
- Use `external next` when the caller wants the stable external-driver protocol with `status`, `summary`, `next.cli`, and summarized `runtime_events`.
- Treat PCB layout evidence as optional. Recommend board ingest only when the current task needs layout, routing, connector, bring-up, or manufacturing evidence; missing PCB files should skip layout checks and keep `can_continue=true`.
- In terminal mode, read the `Events:` line as the shortest explanation of why the runtime recommended the next step.
- If `next` surfaces hardware-document chip-support guidance, the intended path is `adapter analysis init` -> agent fills artifact -> `adapter derive --from-analysis`.
- If the task is a reported bug, prefer a reproducible feedback loop and `capability run debug` before implementation.
- If the task is broad or ambiguous, prefer `task add` or `capability run scan` before `plan` or `do`; keep open questions in task/project truth instead of chat-only state.
- If schematic or PCB review raises advice, keep routing non-blocking unless the current task explicitly depends on the affected electrical, layout, bring-up, or manufacturing fact.
