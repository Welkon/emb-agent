---
name: emb-schematic
description: Inspect normalized schematic artifacts without writing hardware truth.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

# emb-schematic

## Purpose

- Inspect normalized schematic artifacts after `ingest schematic`.
- Query components, nets, BOM rows, and raw typed objects from `parsed.json`.
- Keep all results analysis-only until controller, pin, and signal roles are confirmed.

## Usage

- Run `schematic summary --parsed <parsed.json>` for the parser, graph, and visual-netlist overview.
- Run `schematic component --ref <designator> --parsed <parsed.json>` before treating a part as the controller.
- Run `schematic net --name <net> --parsed <parsed.json>` to inspect members, evidence, and confidence.
- Run `schematic bom --parsed <parsed.json>` for grouped component candidates.
- Run `schematic preview --parsed <parsed.json>` to locate generated `preview.svg` and inspect preview primitive coverage.
- Run `schematic raw --record <n> --parsed <parsed.json>` when a net or component needs record-level evidence.
- When ingest provides `preview.svg`, use it as an orientation aid only. It is generated from SchDoc drawing primitives and should not replace net evidence or datasheet confirmation.
