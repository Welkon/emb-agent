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
