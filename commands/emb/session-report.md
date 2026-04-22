---
name: emb-session-report
description: Write a lightweight report for the current session.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-session-report

## Purpose

- Write a lightweight report for the current session.
- Prefer `session record` for new usage; `session-report` remains as a compatibility alias.
- Refresh repo-visible continuity artifacts under `.emb-agent/reports/sessions/`:
  `CURRENT.md`, `CURRENT.json`, and `INDEX.md`.

## Usage

- Run `$emb-session-report` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- Treat `report-*.md` and `report-*.json` as immutable checkpoints.
- Treat `CURRENT.*` and `INDEX.md` as the human-facing continuity surface for the latest handoff.
