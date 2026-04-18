---
name: emb-ingest
description: Write new facts into truth files or import source documents.
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

- Write new facts into truth files or import source documents.
- Pull durable project truth out of manuals, schematics, and other evidence when the answer is not already known.

## Usage

- Run `$emb-ingest` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- For PDFs and manuals, prefer:
  `ingest doc --file <path> --provider mineru --kind datasheet --to hardware`
- If the PDF is still missing but the chip or schematic already hints at it, use:
  `doc lookup --chip <name> --vendor <name>`
- For schematics or schematic exports, prefer:
  `ingest schematic --file <path>`
- `declare hardware` / `ingest hardware` return `write_mode: truth-write` because they update truth files directly.
- `ingest doc` returns `write_mode: staged-truth` when it has a target truth file; review `apply_ready` and then use `ingest apply doc ...` to write the selected fields.
- `ingest schematic` returns `write_mode: analysis-only`, `truth_write.direct: false`, and `apply_ready: null`; it only prepares artifacts for agent analysis.
- After schematic ingest, use the returned parsed artifacts as agent input and confirm controller/signals/peripherals before writing truth.
- For normalized part-search inputs from a schematic, use:
  `component lookup --file <path>`
- For explicit supplier candidates from SZLCSC / LCSC, use:
  `component lookup --file <path> --provider szlcsc`
- `doc lookup` and `component lookup` return `result_mode: candidate-only`; they surface evidence or supplier candidates and never write truth by themselves.

## Prefer The Lightest Truth Path

- If the engineer already knows the MCU, package, signals, or peripheral ownership, prefer `declare hardware` first.
- If the answer still lives in a PDF or schematic, prefer `ingest`.
- If a parsed result includes `apply_ready`, apply that truth before returning to `next`.
