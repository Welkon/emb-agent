# GEMINI.md

## Quick Routing

| Task | Required reads | Workflow |
| --- | --- | --- |
| Multi-step implementation | `skills/{{NAME}}/SKILL.md` | `workflows/subagent-driven.md` |
| Multiple independent sub-tasks | `skills/{{NAME}}/SKILL.md` | `workflows/subagent-driven.md` |
| Other | `skills/{{NAME}}/SKILL.md` | `<!-- FILL: default workflow path -->` |

## Auto Triggers

- Any non-trivial task must run Task Closure Protocol before completion.
- On a fresh Gemini session, re-enter through this file before trusting prior context.

## Red Flags - STOP

- "就这一次跳过 AAR"
- "任务很小不用扫"
- "等会话结束一起补"

## Gemini Notes

- Reuse the shared protocol blocks from `templates/protocol-blocks/`.
- Do not add project-specific defaults here without passing the anti-template test.
- <!-- FILL: Gemini-specific workflow rule -->
