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
- MinerU API ZIP results are cached with `images/...` assets under `.emb-agent/cache/docs/<doc-id>/`; if `parse.md` references an image, inspect that cached asset or rerun `ingest doc --force` before trying PDF rendering or web image workarounds.
- If the PDF is still missing but the chip or schematic already hints at it, use:
  `doc lookup --chip <name> --vendor <name>`
- To extract datasheet links from LCEDA/EasyEDA search results, use:
  `doc lookup --keyword <part-or-lcsc-id> --provider lceda`
- For schematics or schematic exports, prefer:
  `ingest schematic --file <path>`
- For multi-page schematics exported as separate sheets, pass each sheet in order:
  `ingest schematic --file <sheet-1> --file <sheet-2>`
- For Altium PCB layout files, use:
  `ingest board --file <board.PcbDoc>`
- `declare hardware` / `ingest hardware` return `write_mode: truth-write` because they update truth files directly.
- `ingest doc` returns `write_mode: staged-truth` when it has a target truth file; review `apply_ready` and then use `ingest apply doc ...` to write the selected fields.
- `ingest schematic` returns `write_mode: analysis-only`, `truth_write.direct: false`, and `apply_ready: null`; it only prepares artifacts for agent analysis.
- After schematic ingest, use the returned `parsed.json`, `analysis.visual-netlist.json`, `analysis.schematic-advice.json`, and `preview.svg` artifacts as agent input and confirm controller/signals/peripherals before writing truth.
- Schematic advice findings are review prompts only. Users may dismiss or ignore them after confirming board intent, datasheet limits, firmware defaults, and BOM values.
- For targeted schematic inspection after ingest, use `schematic summary --parsed <parsed.json>`, `schematic component --ref <designator> --parsed <parsed.json>`, or `schematic net --name <net> --parsed <parsed.json>`.
- `ingest board` directly reads Altium `.PcbDoc` OLE/CFB containers and returns `write_mode: analysis-only`; it prepares `analysis.board-layout.json` and `analysis.board-advice.json` without writing truth.
- Board advice findings are review prompts only. Users may dismiss or ignore them after confirming schematic intent, datasheet layout guidance, current limits, mechanical constraints, and fabrication rules.
- PCB layout evidence is optional. If no board file is available, continue and mark placement, routing, copper, connector-access, DFM, and EMI-layout checks as skipped rather than blocked.
- For targeted PCB inspection after ingest, use `board summary --parsed <analysis.board-layout.json>`, `board pads --ref <designator> --parsed <analysis.board-layout.json>`, `board tracks --name <net> --parsed <analysis.board-layout.json>`, `board advice --parsed <analysis.board-layout.json>`, or `board raw --record <n> --parsed <analysis.board-layout.json>`.
- For PCB layout automation, install/use a support skill such as `$altium-pcb` against the returned `analysis.board-layout.json`. emb-agent core keeps board ingestion and board queries read-only.
- For normalized part-search inputs from a schematic, use:
  `component lookup --file <path>`
- `doc lookup` and `component lookup` return `result_mode: candidate-only`; they surface evidence or manual search inputs and never write truth by themselves.

## Prefer The Lightest Truth Path

- If the engineer already knows the MCU, package, signals, or peripheral ownership, prefer `declare hardware` first.
- If the answer still lives in a PDF or schematic, prefer `ingest`.
- If a parsed result includes `apply_ready`, apply that truth before returning to `next`.
