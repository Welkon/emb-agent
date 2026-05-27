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
- On first run or when `.emb-agent/` is incomplete, route to `onboard` before `init`, `declare hardware`, `scan`, or implementation.
- `onboard` decides whether this is an empty repo, partial `.emb-agent/`, or migration from existing datasheets/schematics/pin maps/build notes.
- It should route to `resume`, `onboard`, the next bootstrap step, `task add`, or `next`.
- During first bootstrap, define `docs/prd/system.md` only after a requirement-exploration pass; then mirror confirmed structured facts into `.emb-agent/req.yaml` before treating it as truth.
- Before PRD confirmation, require child execution PRDs under `docs/prd/features|modules|components|subsystems/*.md`; do not jump directly from system PRD to `task add`.
- It may surface PCB layout evidence when board files or parsed board artifacts are present, but PCB evidence is optional and missing board files must not block startup or task routing.
- When `start` routes to `task add`, treat that as task intake: create the task/PRD first, align unclear items with the user until explicit agreement, then use `capability run scan` if scope is still fuzzy or `capability run plan` when the path is already explicit.
- Use `start --brief` when a wrapper only needs compact bootstrap guidance plus summarized `runtime_events`.
- Use `external start` when the caller needs the stable external-driver envelope instead of the full start payload.
- In normal terminal mode, read the `Events:` line as the shortest structured explanation of why start routed you forward.
