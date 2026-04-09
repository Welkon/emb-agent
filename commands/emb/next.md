---
name: emb-next
description: Recommend the most reasonable next step for the current session.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-next

## Purpose

- Recommend the most reasonable next step for the current session.

## Usage

- Run `$emb-next` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
