---
name: emb-start
description: Summarize project truth, task state, and the shortest default workflow to continue.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-start

- Use `$emb-start` at the beginning of a session or after a major context switch.
- It is the single repository entrypoint.
- It should route to `resume`, the next bootstrap step, `task add`, or `next`.
