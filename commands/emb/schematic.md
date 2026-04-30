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
- Query components, nets, BOM rows, dismissible review advice, and raw typed objects from `parsed.json`.
- Keep all results analysis-only until controller, pin, and signal roles are confirmed.

## Usage

- Run `schematic summary --parsed <parsed.json>` for the parser, graph, and visual-netlist overview.
- Run `schematic component --ref <designator> --parsed <parsed.json>` before treating a part as the controller.
- Run `schematic net --name <net> --parsed <parsed.json>` to inspect members, evidence, and confidence.
- Run `schematic bom --parsed <parsed.json>` for grouped component candidates.
- Run `schematic advice --parsed <parsed.json>` to inspect dismissible hardware review prompts generated from normalized schematic evidence.
- Run `schematic preview --parsed <parsed.json>` to locate generated `preview.svg` and inspect preview primitive coverage.
- Run `schematic raw --record <n> --parsed <parsed.json>` when a net or component needs record-level evidence.
- Treat schematic advice as advisory-only. It can be dismissed or ignored when board intent, datasheet limits, firmware defaults, or BOM values make the prompt irrelevant.
- When ingest provides `preview.svg`, use it as an orientation aid only. It is generated from SchDoc drawing primitives and should not replace net evidence or datasheet confirmation.
