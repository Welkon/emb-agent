---
name: emb-ingest
description: Write new facts into truth files or import external documents.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-ingest

## Purpose

- Write new facts into truth files or import external documents.

## Usage

- Run `$emb-ingest` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- For PDFs and manuals, prefer:
  `ingest doc --file <path> --provider mineru --kind datasheet --to hardware`
- For schematics or schematic exports, prefer:
  `ingest schematic --file <path>`
