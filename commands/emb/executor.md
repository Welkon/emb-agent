---
name: emb-executor
description: Run executor actions and summarize the latest execution result.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-executor

## Purpose

- Run executor actions and summarize the latest execution result.

## Usage

- Run `$emb-executor` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
