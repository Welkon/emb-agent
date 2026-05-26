---
name: emb-board
description: Inspect normalized PCB layout artifacts without writing hardware truth.
allowed-tools:
  - SlashCommand
---

# emb-board

## Purpose

- Inspect normalized PCB layout artifacts after `/emb:ingest board`.
- Query board summary, components, pads, tracks, vias, texts, nets, dismissible layout review advice, and raw Altium PcbDoc records through `/emb:board ...`.
- Keep all results analysis-only. Component placement and other CAD automation belong in external support skills, not emb-agent core.
- Treat PCB layout evidence as optional. Missing board files skip layout-dependent checks but must not block firmware, schematic, datasheet, or task workflow progress.

## Usage

- Trigger `/emb:board summary --parsed <analysis.board-layout.json>` for parser coverage, board bounds, layer stack, and layout-advice overview.
- Trigger `/emb:board components --parsed <analysis.board-layout.json>` to inspect recognized placed components.
- Trigger `/emb:board pads --parsed <analysis.board-layout.json> --ref <designator>` to inspect decoded pad ownership and nets for a component.
- Trigger `/emb:board tracks --parsed <analysis.board-layout.json> --name <net>` or `/emb:board vias --parsed <analysis.board-layout.json> --name <net>` to inspect routing facts for a net.
- Trigger `/emb:board texts --parsed <analysis.board-layout.json> --name <text>` to inspect recognized overlay text and labels.
- Trigger `/emb:board nets --parsed <analysis.board-layout.json>` to inspect recognized layout nets.
- Trigger `/emb:board advice --parsed <analysis.board-layout.json>` to inspect dismissible PCB layout review prompts.
- Trigger `/emb:board raw --record <n> --parsed <analysis.board-layout.json>` when a layout fact needs record-level evidence.
- For PCB layout automation, use an installed support skill such as `$altium-pcb` against the parsed board layout JSON.
- Inspect `pads[].x_size_mm`, `pads[].bounds`, `component_bodies[]`, and `binary_regions[]` when collision evidence needs parser-level detail. `binary_regions[]` currently contains stable `Regions6` raw polygon geometry; `ShapeBasedRegions6` requires a separate transform before it is safe to use as board geometry.
- Treat board advice as advisory-only. It can be dismissed or ignored when board intent, datasheet layout guidance, current limits, mechanical constraints, or fabrication rules make the prompt irrelevant.
- If no PCB file is available, continue the workflow and record layout checks as skipped, not blocked.
- If object coverage is incomplete, treat that as parser evidence. Do not infer placement or routing quality until relevant components, pads, tracks, zones, and nets are present in normalized layout facts.
