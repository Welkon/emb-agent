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
- Record lightweight session closure notes and continuity artifacts.
- Review stored session history without scraping markdown manually.

## Usage

- Run `$emb-session` when the task is about continuity, handoff, or session history.
- Use `session show` for the live state, `session history` for stored reports, and `session record` when you want to capture a new report.
- Read `.emb-agent/reports/sessions/CURRENT.md` when a human needs the shortest repo-visible continuity summary.
- Read `.emb-agent/reports/sessions/INDEX.md` when you need a compact list of stored checkpoints without scanning raw files.
