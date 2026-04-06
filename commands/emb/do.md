---
name: emb-do
description: Execute direct lightweight embedded changes using installed emb-agent runtime context.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-do

你负责用 emb-agent 的轻量方式直接推进改动。

## 执行规则

1. 先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" resume`
2. 必要时先做最小 `scan`，再直接修改代码或文档。
3. 查看 `do` 输出里的 `agent_execution` 和 `dispatch_contract`：
   - `inline-preferred`: 直接做最小改动
   - `primary-plus-supporting`: 优先启动 `dispatch_contract.primary.agent`；若当前运行时只支持通用 `spawn_agent`，则按 `dispatch_contract.primary.spawn_fallback` 执行，再按需并行启动只读 supporting agent
4. 如果 `agent_execution.recommended = true`，不要停留在说明层，直接发起对应子 agent。
5. 完成后给出：
   - Changed
   - Why
   - Verification
   - Remaining risk

## 要求

- 不引入重 planning
- 默认选择更小、更浅、更直接的实现
- 改硬件行为前先查真值来源
- 不要同时让多个可写 agent 修改同一组文件
- 主线程始终保留最终整合权和最终落盘责任
