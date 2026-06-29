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
- Use `finish-work` or `task finish-work` to close current work with a workspace journal and task resolution.
- Use `session show` for live state, `session journal` or `session history` for stored workspace history, and `session record` when you only want to capture a report without resolving a task.
- Use `session finish-work --no-resolve` when you want finish-work journal formatting without changing task status.
- Record closure notes with `session record --title "..." --summary "..." [--detail "..."] [--commit HASH] [--test CMD] [--next "..."]`.
- Read `.emb-agent/workspace/index.md` for the cross-developer journal index.
- Read `.emb-agent/workspace/<developer>/index.md` and `journal-N.md` for per-developer session history.
