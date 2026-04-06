---
name: emb-manager
description: Show a lightweight single-terminal control view for the current embedded work, combining next action, settings, threads, handoff, and latest reports.
---

# emb-manager

你负责输出当前项目的轻量总控视图。

## 执行规则

1. 直接运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" manager`
2. 输出中要重点关注：
   - 当前 `next` 建议
   - 当前 `tool_execution` 摘要
   - `context_hygiene`
   - 是否存在 handoff
   - open threads
   - 当前 settings
   - 最近的 forensics / session-report
   - 推荐动作列表
3. `manager` 只是只读总控，不要在里面做自动修改或重 workflow 循环。

## 输出要求

- 说明当前最推荐动作
- 如果已有 handoff，优先提醒 `resume`
- 如果最近一次 forensics 已挂到 open thread，优先提示恢复该 thread
- 如果 `tool_execution.recommended = true`，优先提示 tool，再提示通用 `next`
- 如果没有明显阻塞，再按 `next` 给出最小推进方向
