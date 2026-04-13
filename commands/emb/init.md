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

## After Init

- If MCU and package are already known, run:
  `declare hardware --mcu <name> --package <name>`
- If the project is still at concept stage, do not guess a chip.
  Keep `hw.yaml` unknown, record goals and constraints in `req.yaml`, then run `next`.
- If external evidence still holds the truth, continue with:
  `ingest doc --file <path> --kind datasheet --to hardware`
  or
  `ingest schematic --file <path>`
- `ingest doc` stages document-derived truth first; apply it after review rather than assuming it already changed `hw.yaml`.

## Typical Next Step

- Most projects should continue with:
  `next`
- If automatic startup or bootstrap does not seem to advance, check:
  `health`
