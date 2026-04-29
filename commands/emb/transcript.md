---
name: emb-transcript
description: Import host conversation transcripts for recovery-only analysis.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-transcript

Use `transcript` only when recovering or migrating context from a host conversation.

This is not the normal emb-agent continuity path. Prefer `session record`, `task aar scan`, and `next` during day-to-day work. Transcript import is for old conversations, host migration, context-loss forensics, and emb-agent workflow development.

## Commands

- `transcript import --provider codex --id <session-id>`
  Import a local Codex session by id when it exists in the host history.
- `transcript import --provider claude --file <transcript>`
  Import a Claude transcript export or captured file.
- `transcript import --provider cursor --file <transcript>`
  Import a Cursor transcript export or captured file.
- `transcript import --provider generic --file <jsonl|json|md|txt>`
  Import a host-independent transcript file.
- `transcript analyze --from <transcript-or-analysis-json>`
  Re-run the deterministic prepass and write reviewable artifacts, including an AI review prompt.
- `transcript review --from <analysis-json> --accept`
  Mark a transcript analysis as reviewed by the active AI assistant and write a `*.reviewed.json` artifact.
- `transcript review --from <analysis-json> --reviewed-file <reviewed-analysis-json>`
  Use an AI-authored reviewed analysis instead of accepting the heuristic buckets as-is.
- `transcript apply --from <analysis-json> --confirm`
  Apply only reviewed recovery signals to live session state. This updates questions, risks, and transcript diagnostics; it does not mutate project truth files.

## Safety

- Import writes review-only artifacts under `.emb-agent/imports/`.
- The built-in parser is only a prepass: it removes host/system noise and proposes candidate buckets.
- Semantic judgment belongs to the active AI assistant reviewing the generated `*.ai-review.md` file.
- `apply` is blocked until semantic review is accepted, unless `--allow-unreviewed` is passed explicitly.
- Apply requires `--confirm`.
- Project truth files such as `.emb-agent/hw.yaml` and `.emb-agent/req.yaml` are never changed automatically.
