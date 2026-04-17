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
- Most of this surface is advanced maintenance. The exception is `support bootstrap`, which is part of the known-chip fast path when you want direct control instead of `bootstrap run`.
