---
name: emb-start
description: Summarize project truth, task state, and the shortest default workflow to continue.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-start

- Use `$emb-start` after a major context switch or when you want to re-render entry guidance manually.
- New sessions should already receive startup context automatically from host hooks.
- On the first run, it should initialize the emb-agent project files automatically before routing forward.
- It should route to `resume`, the next bootstrap step, `task add`, or `next`.
- It may surface PCB layout evidence when board files or parsed board artifacts are present, but PCB evidence is optional and missing board files must not block startup or task routing.
- When `start` routes to `task add`, treat that as task intake: create the task/PRD first, then use `capability run scan` if scope is still fuzzy or `capability run plan` when the path is already explicit.
- Use `start --brief` when a wrapper only needs compact bootstrap guidance plus summarized `runtime_events`.
- Use `external start` when the caller needs the stable external-driver envelope instead of the full start payload.
- In normal terminal mode, read the `Events:` line as the shortest structured explanation of why start routed you forward.
