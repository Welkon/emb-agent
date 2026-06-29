---
name: emb-insight
description: Auto-extract key decisions, pitfalls, and invariants from task closure and write back to wiki.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
---

# emb-insight

## Purpose

- At task finish-work, automatically extract durable learnings from the task PRD, diff, trace entries, and workspace journal — and write them back to the wiki so they survive beyond the task.
- Session insight is the bridge between ephemeral task execution and persistent project memory. Without it, key decisions and gotchas are lost when the task closes.

## Commands

- `insight extract [--task <name>] [--confirm]` — Scan the current (or named) task's PRD, diff, trace entries, and workspace journal. Extract key decisions, pitfalls, and invariants, then draft wiki pages. Re-run with `--confirm` to write.
- `insight decisions [--task <name>]` — List decisions extracted from a task.
- `insight pitfalls [--task <name>]` — List pitfalls and how they were resolved.
- `insight invariants [--task <name>]` — List invariants discovered or reinforced.
- `insight stale-check` — Scan wiki pages with `stale_after` frontmatter and flag expired ones.

## Extraction Rules

When `insight extract` runs, it reads:

1. **Task PRD** (`.emb-agent/tasks/<name>/prd.md`): goal, constraints, acceptance criteria
2. **Diff** (git diff for the task's changed files): what actually changed
3. **Trace entries** (`.emb-agent/trace/trace.jsonl` filtered by task): phase-by-phase record
4. **Workspace journal** (`.emb-agent/workspace/<developer>/journal-N.md` if present): developer session notes

From these it extracts:

### Decisions
Any choice where multiple options existed and one was selected. Look for:
- "chose X over Y", "decided to", "went with", "opted for"
- Tradeoff language: "simpler but slower", "more complex but safer"
- Write to `wiki/decisions/<slug>.md` using the decision-log template

### Pitfalls
Problems encountered and how they were resolved. Look for:
- "initially tried X but", "first attempt failed", "surprising behavior"
- "watch out for", "gotcha", "edge case"
- Write to `wiki/<topic>-pitfalls.md` or append to existing page if one exists

### Invariants
Facts that must remain true, discovered or reinforced during this task. Look for:
- "must always", "must never", "guaranteed by", "invariant"
- Hardware constraints: timing, voltage, register sequences
- Write to `wiki/<topic>-invariants.md` or the relevant domain-knowledge page

### Open Questions
What remains unknown after this task. Write to `wiki/queries/<slug>.md`.

## Workflow

1. After `task finish-work`, the agent records closure context with `session record`, then runs `insight extract --confirm` automatically (or prompts the user if auto-runner is off).
2. `insight extract` drafts wiki pages and prints a preview. With `--confirm`, it writes them.
3. After writing, run `knowledge graph refresh` to index the new wiki pages.
4. Run `insight stale-check` periodically to surface wiki pages past their `stale_after` date.

## Rules

- Never overwrite existing wiki content without explicit confirmation. Append new findings or create new pages.
- Link new wiki pages back to the task (add `references: ["[[task: <name>]]"]` in frontmatter).
- If a decision, pitfall, or invariant was already documented in wiki, link to it rather than duplicating.
- Treat insights as draft until reviewed. Mark `confidence: medium` unless confirmed by measurement or review.
- Stale checking is advisory only — never auto-delete wiki pages.
