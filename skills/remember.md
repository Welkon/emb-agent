---
name: remember
description: Persist a stable cross-session conclusion into emb memory.
when_to_use: Use when the current session produced a durable user preference, project fact, or reusable engineering conclusion that should survive the next resume.
allowed_tools:
  - memory
  - session
execution_mode: inline
---

# remember

Use this skill to turn a stable conclusion into durable emb memory instead of leaving it stranded inside the current session.

## Checklist

- Save only cross-session conclusions.
- Prefer user or feedback memories for workflow preferences and corrections.
- Prefer project or reference memories for hardware truth, release constraints, or durable engineering notes.
- Do not store facts that can be re-derived cheaply from code or version history.

## Suggested Follow-up

- `memory remember --type <user|feedback|project|reference> <summary> --detail <detail>`
- `memory audit`
- `memory promote <entry> --to <user|project|local>`
