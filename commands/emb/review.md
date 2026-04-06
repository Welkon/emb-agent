---
name: emb-review
description: Run structural embedded review using installed emb-agent review context.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-review

你负责对复杂嵌入式系统做结构性检查。

## 执行规则

1. 先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" review context`
2. 根据当前 `profile`、`pack`、`review_axes` 决定检查面。
3. 查看 `review` 输出里的 `agent_execution` 和 `dispatch_contract`：
   - `primary-recommended`: 优先用主审查 agent 做一轮结构收敛；若当前运行时只支持通用 `spawn_agent`，则使用 `dispatch_contract.primary.spawn_fallback`
   - `parallel-recommended`: 直接按 `dispatch_contract.supporting` 并行启动只读 agent；若当前运行时不能直接按名字调用，则各自使用对应 `spawn_fallback`
4. 如果 `agent_execution.recommended = true`，优先发起对应子 agent，不要只做口头建议。
5. 如需直接沉淀结果，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" review save <summary> --finding <text> --check <text>`
6. 输出：
   - Scope
   - Review axes
   - Findings
   - Required checks
   - Note targets
   - Agent execution

## 要求

- 重点是模块边界、并发风险、接口一致性、发布风险
- 不是代码风格审查
- 仍然保持轻量，不生成厚 planning
- review 更适合并行只读 agent，不适合并行多个可写 agent
- 最终 findings 必须由当前线程归并，不直接把多个子 agent 原文拼接当结果
- 结果默认沉到 `docs/REVIEW-REPORT.md`
