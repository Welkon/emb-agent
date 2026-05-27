---
name: emb-agent
description: Embedded firmware workflow — project truth, task tracking, knowledge wiki, schematic analysis, chip support. Use when the user works on firmware or embedded hardware.
globs:
  - "**/*.c"
  - "**/*.h"
  - "**/*.cpp"
  - "**/*.s"
  - "**/*.S"
  - "**/*.yaml"
  - "**/hw.yaml"
  - "**/req.yaml"
---

# emb-agent

You are working in a firmware project with emb-agent installed. emb-agent manages
project state, tasks, hardware truth, and knowledge artifacts. Use it to stay
grounded.

## CLI entry

```
node <project>/.<host>/emb-agent/bin/emb-agent.cjs <command>
```
Common host dirs: .omp (Oh My Pi), .cursor (Cursor), .codex (Codex), .claude (Claude), .pi (Pi).

## Quick Routing

| Need | Command |
|------|---------|
| Initialize / migrate project | `emb-onboard` agent |
| What next? | `next --brief` |
| Project health | `health` |
| List active tasks | `task list` |
| Activate a task | `task activate <name>` |
| Create a task | `task add <summary>` |
| Scan current state | `capability run scan` |
| Plan implementation | `capability run plan` |
| Implement | `capability run do` |
| Review changes | `capability run review` |
| Verify against hw | `capability run verify` |
| Knowledge wiki | `knowledge show <page>` |
| Graph query | `knowledge graph query <term>` |
| Record decision | `decision record` |
| Ingest datasheet | `ingest doc <path>` |
| Analyze schematic | `schematic analyze <path>` |
| Task AAR | `task aar scan` |
| Board signoff | `verify board --result pass <summary>` |
## Session Flow

1. On session start, emb-agent auto-injects project state via the OMP extension.
2. If the status bar says `emb: activate`, use `/emb-next` or `next --brief` to see
   available tasks, then activate one.
3. Once a task is active, follow the workflow: scan → plan → do → review → verify.
4. After any significant workflow exit (bug closed, feature implemented, review completed),
   run the post-flow knowledge capture checklist below. Do NOT skip this — it is the
   compound-interest mechanism that makes each task improve future ones.

## Post-Flow Knowledge Capture (mandatory at every workflow exit)

Before declaring any non-trivial task complete, check:
- [ ] **Trap?** — Did you hit a chip-specific quirk, register behavior, or timing constraint
  not documented in the datasheet? → `compound trap --slug "..." --summary "..." --chip X`
- [ ] **Trick?** — Did you use or develop a reusable pattern (PWM config sequence, ADC
  calibration routine, ISR structure)? → `compound trick --slug "..." --summary "..."`
- [ ] **Decision?** — Was a design tradeoff made (peripheral choice, ISR priority split,
  memory layout)? → `compound decide --slug "..." --summary "..."`
- [ ] **Learn?** — Did you discover something about the codebase or hardware that a fresh
  agent would not infer from code and datasheets alone? → `compound learn --slug "..." --summary "..."`

Recording threshold (from `.emb-agent/reference/knowledge-evolution.md`):
record only if repeatable AND (expensive OR not-visible-in-code).
Skip: generic programming patterns, facts obvious from datasheets, vendor SDK conventions.

## Rules

- Never guess hardware facts. Read `.emb-agent/hw.yaml` and `.emb-agent/req.yaml`.
- Wiki pages go under `.emb-agent/wiki/`, not `docs/`.
- `docs/prd/` is for PRDs; `.emb-agent/wiki/` is for project memory.
- Before confirming a PRD, interrogate missing constraints with the user.
- Run `next --brief` after significant state changes.
- Trust `agent_protocol.gate` — it tells you what actions are allowed right now.
- If `.emb-agent/` does not exist or is incomplete, route to `emb-onboard` agent first.