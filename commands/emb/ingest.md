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
- If the PDF is still missing but the chip or schematic already hints at it, use:
  `doc lookup --chip <name> --vendor <name>`
- For schematics or schematic exports, prefer:
  `ingest schematic --file <path>`
- After schematic ingest, use the returned parsed artifacts as agent input and confirm controller/signals/peripherals before writing truth.
- For normalized part-search inputs from a schematic, use:
  `component lookup --file <path>`
- For explicit supplier candidates from 立创商城, use:
  `component lookup --file <path> --provider szlcsc`
