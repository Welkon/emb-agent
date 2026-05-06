---
name: emb-init
description: Initialize the current project with emb-agent defaults and truth layers.
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - SlashCommand
---

# emb-init

## Purpose

- Initialize the current project with emb-agent defaults and truth layers.
- Create the minimum shared files that let the session work from repository truth instead of ad-hoc chat state.

## Usage

- Run `$emb-init` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.

## What It Creates

- `.emb-agent/project.json`
- `.emb-agent/hw.yaml`
- `.emb-agent/req.yaml`
- starter docs, caches, and bootstrap checklists

## Workflow Specs

- `init` can activate workflow specs with `--spec <name>`.
- If the current workflow registry exposes multiple selectable specs and `init` runs in an interactive terminal, it will offer a spec picker before writing `.emb-agent/project.json`.
- Registry import happens before that choice, so specs brought in through `--registry` are available in the same `init` run.
- Additional workflow specs can be enabled later with `spec add <name>`.

## Monorepo Detection

- When the repository exposes a typical workspace layout such as `pnpm-workspace.yaml`, `package.json workspaces`, or `.gitmodules`, `init` records detected packages in `.emb-agent/project.json`.
- The detected package list becomes the project default package context for later task routing and session state.

## After Init

- If MCU and package are already known, run:
  `declare hardware --mcu <name> --package <name>`
- If the project is still at concept stage, do not guess a chip.
  Keep `hw.yaml` unknown, record goals and constraints in `req.yaml`, then run `next`.
- If the truth still lives in project documents, continue with:
  `ingest doc --file <path> --kind datasheet --to hardware`
  or
  `ingest schematic --file <path>`
- `ingest doc` stages document-derived truth first; apply it after review rather than assuming it already changed `hw.yaml`.
- If document ingest later becomes chip-support work, initialize an analysis artifact first:
  `adapter analysis init --chip <name>`
  then derive from that artifact with:
  `adapter derive --from-analysis <path>`

## Typical Next Step

- Most projects should continue with:
  `next`
- Known-chip projects should still continue with `next` first. Generate or install chip/tool support only when a concrete `tool run <name>` path needs chip-specific formulas or bindings.
- If automatic startup or bootstrap does not seem to advance, check:
  `health`
