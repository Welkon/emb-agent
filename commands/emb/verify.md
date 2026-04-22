---
name: emb-verify
description: Close implementation work with verification targets, evidence, and results.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-verify

## Purpose

- Close implementation work with verification targets, evidence, and results.

## Usage

- Run `$emb-verify` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- If the project declares `quality_gates.required_skills`, close those executable skill checks first; fall back to human signoff only for the remaining required signoffs.
