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
- Use `external next` when the caller wants the stable external-driver protocol with `status`, `summary`, `next.cli`, and summarized `runtime_events`.
- In terminal mode, read the `Events:` line as the shortest explanation of why the runtime recommended the next step.
- If `next` surfaces hardware-document chip-support guidance, the intended path is `support analysis init` -> agent fills artifact -> `support derive --from-analysis`.
