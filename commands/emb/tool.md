---
name: emb-tool
description: Inspect, recommend, and run abstract tool calculations.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-tool

## Purpose

- Inspect, recommend, and run abstract tool calculations.

## Usage

- Run `$emb-tool` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.

## Commands

```bash
emb-agent tool run <name> [options]
emb-agent tool run <name> [options] --save-output
emb-agent tool run <name> [options] --save-output --output-file .emb-agent/runs/<name>.json
```

## Saved Outputs

- `--save-output` and `--save` write the full tool result under `.emb-agent/runs/`.
- `--output-file <path>` chooses an explicit output path and implies `--save-output`.
- Save flags are removed before the project-local adapter runs, so they do not pollute tool parameters.
- If the result includes `register_writes.firmware_snippet_request`, the JSON result includes a `next_steps` entry for `snippet draft --from-tool-output <saved-file> --confirm`.
