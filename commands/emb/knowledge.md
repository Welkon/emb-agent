---
name: emb-knowledge
description: Maintain the project-local persistent knowledge wiki.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-knowledge

## Purpose

- Maintain `.emb-agent/wiki/` as a persistent synthesis layer between raw sources and project truth.
- Keep durable engineering conclusions, source summaries, decisions, risks, and cross-references visible in markdown.
- Preserve `hw.yaml` and `req.yaml` as confirmed structured truth; wiki pages may contain draft synthesis, gaps, and candidates.

## Commands

- `knowledge init`
- `knowledge index [--rebuild]`
- `knowledge log [--tail <n>]`
- `knowledge lint`
- `knowledge show <wiki/path>`
- `knowledge save-query [--confirm] <title> [--summary <text>] [--body <text>] [--kind <query|decision|risk|chip|peripheral|board>] [--link <path>] [--force]`
- `knowledge ingest [--confirm] <source-title> [--summary <text>] [--body <text>] [--link <path>] [--force]`

## Workflow

1. Run `knowledge init` to create the wiki scaffold.
2. After ingesting a datasheet, schematic, board file, or useful analysis, run `knowledge ingest <source-title>` to draft a durable source synthesis page.
3. When a question produces a reusable engineering answer, run `knowledge save-query <title>` to preview the page, then re-run with `--confirm` after checking the content.
4. Run `knowledge lint` periodically to find missing control files, orphan pages, unindexed pages, and chip truth with no matching chip wiki page.

## Rules

- Do not promote wiki claims into `hw.yaml` or `req.yaml` without explicit evidence review.
- Treat wiki pages as persistent synthesis, not runtime gates.
- Prefer small linked pages over one large catch-all page.
- Keep source pages under `wiki/sources/`, chip pages under `wiki/chips/`, decisions under `wiki/decisions/`, and risks under `wiki/risks/`.
