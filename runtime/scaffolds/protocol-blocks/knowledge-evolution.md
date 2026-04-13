# Knowledge Evolution

## Recording Threshold

Promote a lesson only if at least 2 of these 3 checks pass:

- Repeatable:
  Will future tasks hit this again?
- Expensive:
  Would missing it waste meaningful debugging or rework time?
- Not visible in code:
  Could a fresh agent infer it directly from code or official docs? If yes, do not record it separately.

## Generalization Rule

Rewrite the discovery so it still makes sense outside the original task.

Use this shape:

1. Concrete discovery
2. Reusable pattern
3. Consequence of ignoring it

## Recording Targets

- `rules/` for stable constraints and conventions
- `references/` for traps and architecture notes
- `workflows/` for ordered steps and completion checks
- `SKILL.md` for task routing changes
- Shell files for harness entry routing changes

## Activation Over Storage

If a future agent walking the normal task path would not naturally read the lesson, then the lesson is stored but not activated.

## Learn From Mistakes

When the agent makes a mistake and is corrected:

1. Search first and confirm whether the rule already exists.
2. Classify the root cause:
   - Missing rule:
     add it only after the recording threshold passes.
   - Outdated rule:
     update it immediately, because stale rules are more harmful than missing rules.
   - Retired rule:
     follow the rule deprecation process.
   - Existing rule was ignored:
     increase its prominence, for example by promoting it from `references/` into `SKILL.md`, a workflow checklist, or a shell entry point.

## Rule Deprecation

Rules must not only accumulate.

- If the related technology was removed, delete the rule.
- If the project is in migration, add a scope marker so the rule only applies where it is still true.
- If you are not yet sure, keep the rule but mark it with `<!-- DEPRECATED: reason, date -->`.

## Split Evaluation

Split a file only when all three are true:

1. The topic can be separated cleanly.
2. Navigation is already difficult.
3. Each resulting file can stand on its own.

If any answer is no, do not split.

## Merge Evaluation

Merge small files only when all three are true:

1. The topics are related.
2. The merged version will be easier to find.
3. The merged file will stay within a manageable size.

If any answer is no, do not merge.

## Homogeneity Drift Check

Periodically run the same Quick Start against two clearly different project types, for example a Go CLI and a Next.js site, then compare the generated trees.

- Shells, hooks, and protocol blocks should stay mostly the same.
- `rules/`, `references/gotchas.md`, and `SKILL.md` Common Tasks should be materially different.

Record every drift review in `ANTI-TEMPLATES.md` under a `Homogeneity Drift Log` section.
