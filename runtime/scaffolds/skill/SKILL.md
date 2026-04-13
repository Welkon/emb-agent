---
name: {{NAME}}
description: {{SUMMARY}}
allowed-tools:
  - Read
  - Bash
---

# {{NAME}}

## Summary

{{SUMMARY}}

## Iron Law

<!-- FILL: define the one closure rule this skill must never skip -->

## Quick Start

1. Read `rules/project-rules.md`.
2. Read `rules/auto-triggers.md`.
3. Read the workflow file that matches the current task.
4. Run `rg -n "FILL:" .` inside this skill directory and close every required field before claiming the scaffold is complete.

## Common Tasks

<!-- FILL: list 3-5 task shapes this skill is allowed to handle -->

## Evolution Rules

### Recording Threshold

Record a lesson only if at least 2 of these 3 checks pass:

- Repeatable:
  Will a future task hit this again?
- Expensive:
  Would missing it waste meaningful time, usually 30+ minutes instead of a few minutes of trial and error?
- Not visible in code:
  Could a fresh agent infer it directly from the code or official docs? If yes, do not record it separately.

### Generalization Rule

When you do record a lesson:

1. Rewrite the project-specific observation into a general pattern.
2. State the consequence of ignoring it.
3. Remove story-only details that only make sense in the original task.

Bad:
- "In the admin dashboard, pagination must reset when switching tabs."

Good:
- "When context changes, such as tabs, views, or filters, reset pagination to page 1 to avoid stale result windows."

### Recording Locations

- Stable constraints or conventions go to `rules/`.
- Traps, lifecycle notes, or architecture gotchas go to `references/`.
- Ordered steps or completion checks go to `workflows/`.
- Task routing changes go to this `SKILL.md`.
- Harness entry routing changes go to the shell files such as `AGENTS.md`, `CODEX.md`, or `CLAUDE.md`.

### Activation Over Storage

A lesson is not complete when it is merely stored.

For any high-cost lesson:

1. Store it in the right file.
2. Activate it on the path that will naturally re-read it next time.

If a future agent following the normal workflow would not naturally read the lesson, then the lesson is only stored, not activated.

### Mistake Handling

When the agent is corrected:

1. Search first and verify whether the rule already exists.
2. Classify the failure:
   - Missing rule:
     add it only if the recording threshold passes.
   - Outdated rule:
     update it immediately.
   - Retired rule:
     deprecate or remove it.
   - Existing rule ignored:
     raise its visibility on the path where it should naturally be seen.

### Rule Retirement

- Remove rules that target deleted technology.
- Add scope markers when the codebase is in migration.
- If unsure, keep the rule but add `<!-- DEPRECATED: reason, date -->`.

### Maintenance Checks

- Split a large file only when the topic separates cleanly, navigation is already difficult, and the split files can stand alone.
- Merge small files only when the topics are related, the result will be easier to find, and the merged file will remain manageable.
- Run periodic homogeneity drift checks across two very different projects. Shells and protocol blocks should stay similar; `rules/`, `gotchas`, and `Common Tasks` should not.

## References

- `references/gotchas.md` starts empty on purpose. Do not pre-fill examples.
