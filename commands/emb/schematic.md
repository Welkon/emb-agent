---
name: emb-schematic
description: Inspect normalized schematic artifacts without writing hardware truth.
allowed-tools:
  - SlashCommand
---

# emb-schematic

## Purpose

- Inspect normalized schematic artifacts after `ingest schematic`.
- If the user asks to "extract", "parse", "ingest", or "提取" a schematic file, do not read/head/file the binary manually. Trigger `/emb:ingest schematic --file <path>` first.
- Query components, nets, BOM rows, dismissible review advice, and raw typed objects from `parsed.json`.
- Keep all results analysis-only until controller, pin, and signal roles are confirmed.

## Usage

- Trigger `/emb:schematic summary` for the parser, graph, and visual-netlist overview.
- Trigger `/emb:schematic component --ref <designator>` before treating a part as the controller.
- Trigger `/emb:schematic net --name <net>` to inspect members, evidence, and confidence.
- Trigger `/emb:schematic bom` for grouped component candidates.
- Trigger `/emb:schematic advice` to inspect dismissible hardware review prompts generated from normalized schematic evidence.
- Trigger `/emb:schematic preview` to locate generated `preview.svg` and inspect preview primitive coverage.
- Trigger `/emb:schematic raw --record <n>` when a net or component needs record-level evidence.
- Treat schematic advice as advisory-only. It can be dismissed or ignored when board intent, datasheet limits, firmware defaults, or BOM values make the prompt irrelevant.
- When ingest provides `preview.svg`, use it as an orientation aid only. It is generated from SchDoc drawing primitives and should not replace net evidence or datasheet confirmation.
