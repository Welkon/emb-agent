---
name: emb-prefs
description: Show or update lightweight embedded preferences that steer emb-agent routing.
---

# emb-prefs

Use the installed runtime command below and nothing else.

## Commands

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs show
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set truth_source_mode hardware_first
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set truth_source_mode code_first
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set plan_mode auto
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set plan_mode always
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set plan_mode never
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set review_mode auto
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set review_mode always
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set review_mode never
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set verification_mode lean
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set verification_mode strict
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs reset
```

## Preference Meaning

- `truth_source_mode`
  控制 `plan` 和后续读取顺序是先看硬件真值，还是先回读代码真实落点。
- `plan_mode`
  控制 `next` 是否更积极地把复杂任务路由到 `plan`。
- `review_mode`
  控制 `next` 是否更积极地把复杂系统路由到 `review`。
- `verification_mode`
  控制 `plan.verification` 是保持精简，还是补上失败路径与边界条件检查。
