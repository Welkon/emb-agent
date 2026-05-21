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

- Maintain `.emb-agent/wiki/` as a persistent synthesis layer between raw sources and project truth — a living knowledge base, not a static spec dump.
- **Specs are coding constraints; wiki is project memory.** Put design rationale, interview conclusions, domain knowledge, abandoned approaches, and "why we chose X over Y" in wiki. Put "code must follow this rule" in specs.
- Maintain `.emb-agent/graph/` as a deterministic relationship index over truth files, wiki pages, tasks, reports, schematic artifacts, saved tool runs, and firmware snippet artifacts.
- Maintain optional `.emb-agent/formulas/*.json` registries for structured formula, register, parameter, and evidence relationships.
- Keep durable engineering conclusions, source summaries, decisions, risks, and cross-references visible in markdown.
- Preserve `hw.yaml` and `req.yaml` as confirmed structured truth; wiki pages and graph candidates may contain draft synthesis, gaps, and ambiguous relationships.

### Wiki Page Kinds

| Kind | Directory | Template | Purpose |
|---|---|---|---|
| `source` | `wiki/sources/` | — | Datasheet/schematic/paper synthesis |
| `chip` | `wiki/chips/` | — | Per-MCU knowledge |
| `decision` | `wiki/decisions/` | `templates/decision-log.md.tpl` | Design decisions, tradeoffs, rejected alternatives |
| `risk` | `wiki/risks/` | — | Known risks and mitigations |
| `domain-knowledge` | `wiki/` (root or subdir) | `templates/domain-knowledge.md.tpl` | Field-specific expertise, mental models, gotchas |
| `interview-notes` | `wiki/` (root or subdir) | `templates/interview-notes.md.tpl` | User interviews, design reviews, external conversations |
| `query` | `wiki/queries/` | — | Reusable Q&A |

Every wiki page SHOULD include frontmatter with `title`, `kind`, `date`, `expires` (or `stale_after`), and `references` (wikilinks). Pages without `expires`/`stale_after` are treated as perpetual.

## Commands

- `knowledge init`
- `knowledge index [--rebuild]`
- `knowledge log [--tail <n>]`
- `knowledge lint`
- `knowledge show <wiki/path>`
- `knowledge graph build`
- `knowledge graph update`
- `knowledge graph refresh`
- `knowledge graph report`
- `knowledge graph query <term>`
- `knowledge graph explain <term>`
- `knowledge graph path <from> <to>`
- `knowledge graph lint`
- `knowledge formula draft --from-tool-output <file> [--confirm] [--chip <name>] [--force]`
- `knowledge save-query [--confirm] <title> [--summary <text>] [--body <text>] [--kind <query|decision|risk|chip|peripheral|board>] [--link <path>] [--force]`
- `knowledge ingest [--confirm] <source-title> [--summary <text>] [--body <text>] [--link <path>] [--force]`

## Workflow

1. Run `knowledge init` to create the wiki scaffold.
2. After ingesting a datasheet, schematic, board file, or useful analysis, run `knowledge ingest <source-title>` to draft a durable source synthesis page.
3. When a question produces a reusable engineering answer, run `knowledge save-query <title>` to preview the page, then re-run with `--confirm` after checking the content.
4. Run `knowledge graph refresh` after wiki/truth/task/tool/snippet changes to rebuild `.emb-agent/graph/graph.json`, `.emb-agent/graph/GRAPH_REPORT.md`, and `.emb-agent/graph/cache/manifest.json` only when missing or stale.
5. After saving a tool run with register writes, run `knowledge formula draft --from-tool-output <file>` to preview a structured formula registry, then re-run with `--confirm` after checking the source evidence.
6. For formulas that must be reused by agents, keep a JSON registry under `.emb-agent/formulas/` with `chip`, `formulas[].expression`, `variables`, `registers`, and `evidence` fields before rebuilding the graph.
7. Run `knowledge graph report` or `knowledge graph lint` to detect stale graph manifests after tracked files change.
8. Use report Suggested Explanations to inspect hot graph nodes, especially tool-run, register, formula, and snippet nodes created by recent work.
9. Run `knowledge graph query <term>`, `knowledge graph explain <term>`, or `knowledge graph path <from> <to>` before broad searches when you need relationship-oriented context.
10. Run `knowledge lint` and `knowledge graph lint` periodically to find missing control files, orphan pages, unindexed pages, chip truth with no matching chip wiki page, stale graph manifests, and ambiguous graph relationships.
11. After `task finish-work`, run `insight extract --confirm` (see emb-insight) to push durable learnings from this task into wiki. Then run `knowledge graph refresh`.
12. Use `insight stale-check` to surface wiki pages past their `stale_after` date.

## Rules

- Do not promote wiki claims into `hw.yaml` or `req.yaml` without explicit evidence review.
- Treat wiki pages and graph edges as persistent synthesis/navigation, not runtime gates.
- Treat graph edges with `basis: AMBIGUOUS` as review prompts, not confirmed truth.
- Treat formula registries as draft engineering evidence unless their `status` and source review explicitly say otherwise.
- Treat `.emb-agent/runs/*.json` and `.emb-agent/firmware-snippets/*.md` as reusable artifacts that should stay linked to registers, formulas, and chips through the graph.
- Refresh the graph when `knowledge graph report` returns `stale: true` or `knowledge graph lint` reports `graph-stale`.
- Prefer small linked pages over one large catch-all page.
- Keep source pages under `wiki/sources/`, chip pages under `wiki/chips/`, decisions under `wiki/decisions/`, and risks under `wiki/risks/`.
- **Wiki vs Spec boundary:** If it says "code must / must not X", put it in a spec. If it says "we chose X because Y" or "here's what we learned about Z", put it in wiki. When in doubt, wiki first — specs can be tightened later.
