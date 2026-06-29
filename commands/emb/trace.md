---
name: emb-trace
description: Cross-task replayable project activity trace — who changed what, why, and under which review.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
---

# emb-trace

## Purpose

- Maintain `.emb-agent/trace/trace.jsonl` as a cross-task, cross-developer project activity stream.
- Each trace entry records: which task changed which files, why, which specs were referenced, who reviewed, and the resulting commit.
- Unlike journal (personal session notes), trace is project-level and replayable — answer questions like "when did this register config change and why?"

## Trace Entry Schema

Each line in `trace.jsonl` is a JSON object:

```json
{
  "timestamp": "2026-05-21T10:30:00Z",
  "task": "03-adc-calibration",
  "phase": "implement",
  "developer": "felix",
  "changed_files": ["firmware/core/adc.c", "firmware/core/adc.h"],
  "referenced_specs": ["embedded-space", "project-local"],
  "referenced_wiki": ["[[adc-driver-design]]"],
  "reviewed_by": "emb-arch-reviewer",
  "commit": "abc123def",
  "summary": "Added ADC calibration routine with 12-sample averaging per embedded-space timing rules",
  "decisions": ["Chose 12 samples over 8 after bench measurement showed jitter reduction"],
  "pitfalls": ["Initial 4-sample approach failed at temperature extremes"],
  "invariants": ["ADC reading must be taken outside ISR context"],
  "open_questions": []
}
```

## Commands

- `trace record` — Record a trace entry for the current active task at the end of a phase (implement, check, finish-work).
- `trace query <task>` — Show all trace entries for a task.
- `trace query --file <path>` — Show all trace entries that touched a specific file.
- `trace query --spec <name>` — Show all trace entries that referenced a spec.
- `trace query --since <date>` — Show trace entries since a date.
- `trace timeline` — Print a chronological summary of all trace entries.

## Workflow

1. **After implement phase**: Run `trace record` to log what was changed, why, and which specs guided the change.
2. **After check phase**: Append review outcome and any new pitfalls/invariants discovered.
3. **After finish-work**: Run `finish-work` or `task finish-work` first. It records the human-readable workspace journal and returns trace/insight follow-up status; run `trace record` only when this runtime implements tracing for the project.

## Rules

- Record trace entries at phase boundaries, not mid-work.
- Changed files must be absolute or project-relative paths.
- If no specs were intentionally referenced, use `referenced_specs: []` (empty array), not omit the field.
- Trace is append-only. Never rewrite old entries — add a new entry that supersedes with `supersedes: "<previous-timestamp>"`.
- Keep summaries brief (one sentence). Details go in wiki via `insight extract`.
