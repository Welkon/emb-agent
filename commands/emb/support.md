---
name: emb-support
description: Manage chip support sources, discovery, derivation, and quality status.
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

- Manage chip support sources, discovery, derivation, and quality status.

## Usage

- Run `$emb-support` when the issue is chip-support maintenance rather than normal project bootstrap.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- This is an advanced maintenance surface, not part of the default firmware-project path.
- Compatibility alias: `adapter` remains accepted, but `support` is the preferred command name.
