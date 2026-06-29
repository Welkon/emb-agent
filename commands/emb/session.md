---
name: emb-session
description: Inspect or record session continuity artifacts.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-session

## Purpose

- Inspect the current live session state.
- Record human-readable session closure notes and continuity artifacts.
- Review stored session history without scraping markdown manually.

## Usage

- Run `$emb-session` when the task is about continuity, handoff, or session history.
- Use `session show` for live state, `session journal` or `session history` for stored workspace history, and `session record` when you want to capture a new report.
- Record closure notes with `session record --title "..." --summary "..." [--detail "..."] [--commit HASH] [--test CMD] [--next "..."]`.
- Read `.emb-agent/workspace/index.md` for the cross-developer journal index.
- Read `.emb-agent/workspace/<developer>/index.md` and `journal-N.md` for per-developer session history.
