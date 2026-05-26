---
name: emb-memory
description: Inspect layered instruction memory and durable auto-memory entries.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-memory

Use `memory` to inspect the layered instruction stack and manage durable emb auto-memory.

## Commands

- `memory stack`
- `memory list`
- `memory show <entry>`
- `memory remember [--confirm] --type <user|feedback|project|reference> <summary> [--detail <text>]`
- `memory extract [--confirm] [note]`
- `memory audit`
- `memory promote [--confirm] <entry> --to <organization|user|project|local>`

## Notes

- Auto-memory is for cross-session conclusions, not temporary scratch notes.
- `memory audit` only proposes promotions; `memory promote` performs the write.
