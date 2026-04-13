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

## Content Boundary

- Record project-specific constraints, unusual architecture, hidden dependencies, and the cases where the agent's default behavior tends to fail.
- Do not record generic programming knowledge, mainstream framework usage, or facts that are already obvious from the code and official docs.
- Prefer "what is different here" over "how software usually works."

## Iron Law

<!-- FILL: define the one closure rule this skill must never skip -->

## Quick Start

1. Read `rules/project-rules.md`.
2. Read `rules/auto-triggers.md`.
3. Read the workflow file that matches the current task.
4. Run `rg -n "FILL:" .` inside this skill directory and close every required field before claiming the scaffold is complete.

## Template Guarantees

- Treat the scaffold structure as load-bearing infrastructure, not optional prose.
- Frontmatter fields, directory layout, shell entry points, routing tables, workflow files, and `<!-- FILL: -->` markers exist to prevent structural forgetting.
- Do not remove a placeholder by accident. Replace it with project truth, or leave it visible so the missing decision stays loud.
- The template should remember the infrastructure so the skill author can focus on project-specific content.
- Do not regenerate this scaffold from scratch during authoring. Copy the template tree and replace placeholders so structure cannot silently disappear.
- Do not prefill concrete business spec examples into shared templates. Leave `FILL` markers and force real project judgment.
- Auto-trigger guidance must survive context compression, so it belongs in thin shells as well as workflows.
- Thin shells may grow to roughly 60 lines when they carry Quick Routing, Auto Triggers, and Red Flags. Do not force them back into 15-line fragments.
- Multi-harness support is explicit. Missing harness entry files such as `GEMINI.md` or the shared `AGENTS.md` means that harness is effectively blind.

## Common Tasks

<!-- FILL: list 3-5 project-specific task shapes this skill is allowed to handle; do not list generic work like "write code" or "fix bugs" -->

## Guidance Style

- Encode constraints, invariants, and context. Do not hardcode low-level implementation steps unless the project truly requires an exact sequence.
- Prefer rules such as "use the project's design tokens" over brittle instructions such as exact class strings or boilerplate snippets.
- Write only enough process to keep the agent on the correct path.

## Helper Scripts

- If this skill relies on repeatable extraction, validation, migration, or report-generation work, add helper scripts under `scripts/`.
- Prefer calling those scripts over generating large boilerplate directly in the prompt.
- Reuse existing repository scripts before inventing new wrappers.
- Keep `scripts/smoke-test.sh` and `scripts/test-trigger.sh` working. They are the preflight checks for structural completeness and discovery coverage.

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

## Skill Quality Checks

- Test activation: confirm the skill triggers for the right task shapes.
- Test routing: confirm each task shape reads the correct workflow and rules.
- Pressure test under time pressure, rule conflicts, and ambiguous specs. Capture the rationalizations that appear.
- Feed failures back through the task AAR path instead of patching the scaffold ad hoc.

## Focus Guard

Split the skill when any of these become true:

- The description accumulates 10 or more trigger phrases from different domains.
- `Common Tasks` grows beyond about 15 items or mixes unrelated work.
- Narrow subdomain tasks keep activating the whole skill.

## References

- `references/gotchas.md` starts empty on purpose. Do not pre-fill examples.
