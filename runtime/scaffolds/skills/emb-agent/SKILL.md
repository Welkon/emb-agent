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
Common host dirs: .cursor (Cursor), .codex (Codex), .claude (Claude), .pi (Pi).

## Quick Routing

| Need | Command |
|------|---------|
| Initialize / migrate project | `onboard` agent |
| What next? | `next --brief` |
| Project health | `health` |
| List active tasks | `task list` |
| Activate a durable task for resumable work | `task activate <name>` |
| Create a durable task when the work needs handoff/resume structure | `task add <summary>` |
| Scan current state | `capability run scan` |
| Plan implementation | `capability run plan` |
| Implement | `capability run do` |
| Review changes | `capability run review` |
| Verify against hw | `capability run verify` |
| Knowledge wiki | `knowledge show <page>` |
| Graph query | `knowledge graph query <term>` |
| Record decision | `decision record` |
| Ingest datasheet/manual | `ingest doc --provider auto --file <path> --kind datasheet --to hardware` |
| Ingest schematic | `ingest schematic --file <path>` |
| Capture a durable lesson when one actually emerged | `task aar scan` |
| Board signoff | `verify board --result pass <summary>` |
| Full command docs | `.<host>/emb-agent/commands/emb/<command>.md` for any installed command; prefer the fast path unless the task needs a specialized command |
## Session Flow

1. On session start, emb-agent auto-injects project state via the installed host integration.
2. If the status bar says `emb: activate`, use `/emb-next` or `next --brief` to see
   available work options. Activate a task only when the work is multi-step, resumable,
   or needs durable handoff; a narrow analysis, explanation, verification run, or small
   fix can stay direct if the scope is explicit.
3. If the user says the current service split, scheduler path, or time-slice flow is hard
   to understand, explain the existing structure first and only then propose a refactor.
4. Once a durable task is active, follow the workflow that fits the work: explain/scan →
   plan → do → review → verify. Not every task starts with implementation.
5. After a substantial workflow exit, capture knowledge only if a reusable lesson,
   invariant, pitfall, or workflow rule actually emerged.
6. For new firmware architecture, default to the official `event-step` control contract:
   one top-level sample → update → apply step. Bare-metal tick loops and RTOS task/timer
   dispatch are backend choices under the same contract, not peer default frameworks.

## Session Insight

Use local session memory when the user asks to resume prior work, recall an old fix,
explain why a decision was made, compare a bug with something seen before, review how
this project usually finishes work, or when you suspect the current failure pattern is
repeating. This is local-only: `mem` reads existing Claude Code / Codex / Pi session logs
from the user's machine and does not upload content.

Prefer these commands:

```bash
node <project>/.<host>/emb-agent/bin/emb-agent.cjs mem search --query "keyword" --cwd <project>
node <project>/.<host>/emb-agent/bin/emb-agent.cjs mem context --query "keyword" --cwd <project>
node <project>/.<host>/emb-agent/bin/emb-agent.cjs mem extract <session-id> --phase brainstorm --cwd <project>
```

Do not blindly write memory output into a file. Decide from the current context whether
to cite it inline, update `prd.md` / design notes, append task notes, call a spec-update
workflow, or only use it as background understanding.

## Post-Flow Knowledge Capture (only when a durable lesson emerged)

Before recording post-flow knowledge, check:
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
Skip routine fixes, generic programming patterns, facts obvious from datasheets, and vendor SDK conventions.

## Core Rules

- Never guess hardware facts. Read `.emb-agent/hw.yaml` and `.emb-agent/req.yaml`.
- Trust `agent_protocol.gate` — it tells you what actions are allowed right now.
- In `prd-exploration`, if `document_evidence_policy.hardware_first=true`, ingest listed schematics and parse datasheets/manuals before asking the first behavior question. PDF parsing uses the configured local tool order, with MinerU as fallback.
- If `graphify` or `markitdown` is missing when first needed and `uv` is available, emb-agent should auto-ensure it globally at user level. Do not install tooling into each project checkout.
- After editing truth files or PRDs, run `validate` or `health`.
- Split work into vertical tracer-bullet slices.
- Use `mem search/context/extract` when cross-session recall would prevent rediscovery or preserve a past decision.
- If `.emb-agent/` is missing or incomplete, route to `onboard` agent first.

For detailed procedures, read command docs on demand:
- PRD / tasks / bugs / knowledge → `.<host>/emb-agent/commands/emb/`
- Post-flow knowledge capture → `.emb-agent/reference/knowledge-evolution.md`
- Project truth files → `.emb-agent/`
