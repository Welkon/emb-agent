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
- `mem search --query <text> [--cwd DIR] [--platform claude|codex|pi|all]` uses local exact + keyword + semantic-hash hybrid recall, with embedded firmware aliases such as watchdog/WDT/看门狗 and sleep/低功耗.
- `mem context --query <text> [--window N] [--session ID]`
- `mem extract <session-id> [--phase brainstorm|implement|review|all] [--grep <text>]`
- `mem show <session-id>` / `mem summary <session-id>` include lifecycle phase spans when available.
- `mem timeline [--limit N]`
- `mem related <session-id>`
- `mem reindex` / `mem stats` / `mem doctor` / `mem prune`
- `mem open <session-id>` / `mem explain --query <text>` / `mem export --format json|markdown`
- `mem promote --query <text> [--target auto|memory|attention|trap|trick|decision|learn|task|prd] [--apply]` dry-runs promotion candidates by default; `--apply` writes selected insights locally.
- `mem diff --left <session-id> --right <session-id>`
- `mem writeback --target auto|memory|attention|trap|trick|decision|learn|task|prd --summary <text> [--detail <text>]`

`mem` reads existing local Claude Code / Codex / Pi JSONL sessions and never uploads content. Search/context/show/related use `.emb-agent/cache/mem/index.json` and rebuild it when stale. The default semantic-hash vector is deterministic/local. To opt in to an external OpenAI-compatible embeddings API, set `EMB_AGENT_EMBEDDING_PROVIDER=openai-compatible`, `EMB_AGENT_EMBEDDING_API_KEY`, and optionally `EMB_AGENT_EMBEDDING_MODEL`, `EMB_AGENT_EMBEDDING_API_BASE`, `EMB_AGENT_EMBEDDING_UPLOAD=summary-only|chunks`. Values may come from shell env, project `.env`, `.emb-agent/.env`, or `EMB_AGENT_ENV_FILE`; shell env wins.

## Notes

- Auto-memory is for durable conclusions, not temporary scratch notes.
- Session memory is evidence, not an automatic write-back target: cite inline, update PRD/design/task notes, or keep it as background depending on the current task.
