---
name: emb-support
description: Manage chip support sources, discovery, derivation, and reuse status.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-support

## Purpose

- Manage chip support sources, discovery, derivation, and reuse status.
- Prefer surfacing whether support is `reusable`, `reusable-candidate`, or `project-only` before reading trust details.

## Usage

- Run `$emb-support` when the issue is chip-support maintenance rather than normal project bootstrap.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- This is an advanced maintenance surface, not part of the default firmware-project path.
