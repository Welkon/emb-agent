---
name: emb-plan
description: Produce a lightweight micro-plan for complex embedded work using installed emb-agent runtime context.
---

# emb-plan

你负责在复杂嵌入式任务前输出一份轻量 `micro-plan`。

## 执行规则

1. 先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" resume`
2. 必要时结合当前 `scan` 结果，先锁定真值来源和真实改动点。
3. 读取 `plan` 输出里的 `agent_execution` 和 `dispatch_contract`：
   - `inline-preferred`: 直接由当前线程完成 `micro-plan`
   - `primary-recommended`: 优先调用 `dispatch_contract.primary.agent`；如果当前运行时只支持通用 `spawn_agent`，则使用 `dispatch_contract.primary.spawn_fallback`
   - `parallel-recommended`: 只把 `dispatch_contract.supporting` 中的侧边问题拆出去，不演化成厚 orchestration
4. 如果 `agent_execution.recommended = true`，优先真正调用安装后的 `emb-*` 子 agent，而不是只复述建议。
5. 如需直接沉淀计划，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" plan save <summary> --risk <text> --step <text> --verify <text>`
6. 输出固定结构：
   - Goal
   - Truth sources
   - Constraints
   - Risks
   - Steps
   - Verification
   - Agent execution

## 要求

- 这是任务级 `micro-plan`
- 默认不生成 `.planning/`
- 默认不展开多 agent 厚链路，只按 `agent_execution` 做最小拆分
- 只在复杂任务前做最小计划；简单任务仍可直接 `scan -> do`
- 子 agent 返回后，必须由当前线程整合回标准 `micro-plan` 结构
- 结果默认沉到 `docs/DEBUG-NOTES.md`
