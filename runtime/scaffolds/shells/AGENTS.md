# AGENTS.md

## Quick Routing

{{INCLUDE:_partials/quick-routing-table.md}}

## Auto Triggers

{{INCLUDE:_partials/auto-trigger-closure.md}}
- If the task added a new pattern, exposed a new trap, found a missing rule, or invalidated an old rule, update the corresponding workflow or rules file before closure.
- If the task splits into multiple independent sub-tasks, switch to the subagent-driven workflow instead of continuing inline.
{{INCLUDE:_partials/auto-trigger-load-bearing.md}}

## Red Flags - STOP

{{INCLUDE:_partials/red-flags-stop.md}}

## Human-Readable Defaults

- Keep guidance hardware-first and name the real blocker.
- Give the exact next command or file before adding extra structure.
- Treat skills, hooks, and wrappers as integration surfaces; they must not override emb-agent runtime gates.
- Avoid generic AI or project-management wording when a concrete board action, artifact, or truth file is known.

## Local Rules

- <!-- FILL: default response language -->
- <!-- FILL: mandatory search tool order -->
- <!-- FILL: project-specific git workflow or review rule -->
- <!-- FILL: exact project constraint 1 -->
- <!-- FILL: exact project constraint 2 -->
