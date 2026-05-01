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
- Maintain `.emb-agent/graph/` as a deterministic relationship index over truth files, wiki pages, tasks, reports, and schematic artifacts.
- Keep durable engineering conclusions, source summaries, decisions, risks, and cross-references visible in markdown.
- Preserve `hw.yaml` and `req.yaml` as confirmed structured truth; wiki pages and graph candidates may contain draft synthesis, gaps, and ambiguous relationships.

## Commands

- `knowledge init`
- `knowledge index [--rebuild]`
- `knowledge log [--tail <n>]`
- `knowledge lint`
- `knowledge show <wiki/path>`
- `knowledge graph build`
- `knowledge graph update`
- `knowledge graph report`
- `knowledge graph query <term>`
- `knowledge graph path <from> <to>`
- `knowledge graph lint`
- `knowledge save-query [--confirm] <title> [--summary <text>] [--body <text>] [--kind <query|decision|risk|chip|peripheral|board>] [--link <path>] [--force]`
- `knowledge ingest [--confirm] <source-title> [--summary <text>] [--body <text>] [--link <path>] [--force]`

## Workflow

1. Run `knowledge init` to create the wiki scaffold.
2. After ingesting a datasheet, schematic, board file, or useful analysis, run `knowledge ingest <source-title>` to draft a durable source synthesis page.
3. When a question produces a reusable engineering answer, run `knowledge save-query <title>` to preview the page, then re-run with `--confirm` after checking the content.
4. Run `knowledge graph build` after wiki/truth/task changes to refresh `.emb-agent/graph/graph.json`, `.emb-agent/graph/GRAPH_REPORT.md`, and `.emb-agent/graph/cache/manifest.json`.
5. Run `knowledge graph query <term>` or `knowledge graph path <from> <to>` before broad searches when you need relationship-oriented context.
6. Run `knowledge lint` and `knowledge graph lint` periodically to find missing control files, orphan pages, unindexed pages, chip truth with no matching chip wiki page, and ambiguous graph relationships.

## Rules

- Do not promote wiki claims into `hw.yaml` or `req.yaml` without explicit evidence review.
- Treat wiki pages and graph edges as persistent synthesis/navigation, not runtime gates.
- Treat graph edges with `basis: AMBIGUOUS` as review prompts, not confirmed truth.
- Prefer small linked pages over one large catch-all page.
- Keep source pages under `wiki/sources/`, chip pages under `wiki/chips/`, decisions under `wiki/decisions/`, and risks under `wiki/risks/`.
