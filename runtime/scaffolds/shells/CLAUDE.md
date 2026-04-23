# CLAUDE.md

## Quick Routing

{{INCLUDE:_partials/quick-routing-table.md}}

## Auto Triggers

{{INCLUDE:_partials/auto-trigger-closure.md}}
{{INCLUDE:_partials/auto-trigger-load-bearing.md}}
- On a fresh Claude session, re-enter through this file before trusting prior context.

## Red Flags - STOP

{{INCLUDE:_partials/red-flags-stop.md}}

## Human-Readable Defaults

- Keep guidance hardware-first and name the real blocker.
- Give the exact next command or file before adding extra structure.
- Treat skills, hooks, and wrappers as integration surfaces; they must not override emb-agent runtime gates.
- Avoid generic AI or project-management wording when a concrete board action, artifact, or truth file is known.

## Claude Notes

- Reuse the shared protocol blocks from `templates/protocol-blocks/`.
- Do not add project-specific defaults here without passing the anti-template test.
- The template should remember harness infrastructure so the skill author can focus on project truth.
- <!-- FILL: Claude-specific workflow rule -->
