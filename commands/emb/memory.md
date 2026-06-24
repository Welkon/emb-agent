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
- `mem extract <session-id> [--phase brainstorm|implement|review|all] [--grep <text>]`
- `mem show <session-id>` / `mem summary <session-id>`
- `mem timeline [--limit N]`
- `mem related <session-id>`
- `mem reindex` / `mem stats` / `mem doctor` / `mem prune`
- `mem open <session-id>` / `mem explain --query <text>` / `mem export --format json|markdown`
- `mem diff --left <session-id> --right <session-id>`
- `mem writeback --target memory|attention|decision|task|prd --summary <text> [--detail <text>]`

`mem` reads existing local Claude Code / Codex / Pi JSONL sessions and never uploads content. Search/context/show/related use `.emb-agent/cache/mem/index.json` and rebuild it when stale.

## Notes

- Auto-memory is for durable conclusions, not temporary scratch notes.
- Session memory is evidence, not an automatic write-back target: cite inline, update PRD/design/task notes, or keep it as background depending on the current task.
