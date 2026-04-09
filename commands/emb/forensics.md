---
name: emb-forensics
description: Collect evidence when flow, handoff, or context has drifted.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-forensics

## Purpose

- Collect evidence when flow, handoff, or context has drifted.

## Usage

- Run `$emb-forensics` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
