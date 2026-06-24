---
name: emb-memory
description: Inspect layered instruction memory and durable auto-memory entries.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-memory

Use `memory` for durable emb auto-memory, and `mem` for local AI session recall.

## Durable Project Memory

- `memory list`
- `memory remember --type <user|feedback|project|reference> --summary <summary> [--detail <text>]`

## Local Session Memory

- `mem list [--platform claude|codex|pi|all] [--limit N]`
- `mem projects [--platform claude|codex|pi|all]`
- `mem search --query <text> [--cwd DIR] [--platform claude|codex|pi|all]`
- `mem context --query <text> [--window N] [--session ID]`
- `mem extract <session-id> [--phase brainstorm|implement|all] [--grep <text>]`

`mem` reads existing local Claude Code / Codex / Pi JSONL sessions and never uploads content.

## Notes

- Auto-memory is for durable conclusions, not temporary scratch notes.
- Session memory is evidence, not an automatic write-back target: cite inline, update PRD/design/task notes, or keep it as background depending on the current task.
