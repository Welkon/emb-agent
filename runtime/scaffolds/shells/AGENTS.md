# AGENTS.md

## Quick Routing

| Task | Required reads | Workflow |
| --- | --- | --- |
| Multi-step implementation | `skills/{{NAME}}/SKILL.md` | `workflows/subagent-driven.md` |
| Bug fix or regression | `skills/{{NAME}}/SKILL.md` | `workflows/fix-bug.md` |
| Rules or protocol update | `skills/{{NAME}}/SKILL.md` | `workflows/update-rules.md` |
| Docs-only maintenance | `skills/{{NAME}}/SKILL.md` | `workflows/maintain-docs.md` |
| Multiple independent sub-tasks | `skills/{{NAME}}/SKILL.md` | `workflows/subagent-driven.md` |
| Other | `skills/{{NAME}}/SKILL.md` | `<!-- FILL: default workflow path -->` |

## Auto Triggers

- Any non-trivial task must run Task Closure Protocol before completion.
- If the task added a new pattern, exposed a new trap, found a missing rule, or invalidated an old rule, update the corresponding workflow or rules file before closure.
- If the task splits into multiple independent sub-tasks, switch to the subagent-driven workflow instead of continuing inline.

## Red Flags - STOP

- "就这一次跳过 AAR"
- "任务很小不用扫"
- "等会话结束一起补"

## Local Rules

- <!-- FILL: default response language -->
- <!-- FILL: mandatory search tool order -->
- <!-- FILL: project-specific git workflow or review rule -->
- <!-- FILL: exact project constraint 1 -->
- <!-- FILL: exact project constraint 2 -->
