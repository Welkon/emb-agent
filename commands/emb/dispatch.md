---
name: emb-dispatch
description: Build a lightweight sub-agent dispatch contract for the current embedded action or next step.
---

# emb-dispatch

你负责把 emb-agent 的动作输出直接转成可执行的轻量分发合同。

## 执行规则

1. 运行以下命令之一：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" dispatch next`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" dispatch show <action>`
2. 读取返回的：
   - `resolved_action`
   - `agent_execution`
   - `dispatch_contract`
   - `context_hygiene`
3. 如果 `agent_execution.recommended = true`：
   - 优先直接启动 `dispatch_contract.primary.agent`
   - 如果当前运行时不能直接按名字调用已安装 agent，就改用 `dispatch_contract.primary.spawn_fallback`
   - fallback 方式下，先读取 `instructions_source_cli`，再用 `spawn_agent(fallback_agent_type, ...)` 启动通用子 agent
   - 只把 `dispatch_contract.parallel_safe` 中明确安全的 supporting agents 并行展开
   - 主线程继续整合，不要空等所有子 agent
4. 如果 `agent_execution.recommended = false`：
   - 直接 inline 执行对应动作
5. 子 agent 返回后，必须由当前线程整合成 emb 标准输出，不直接拼接原文。

## 要求

- 这是轻量分发，不是 GSD 式厚 orchestration
- 不要同时让多个可写 agent 修改同一组文件
- clear context 风险以 `context_hygiene` 为准；必要时先 `pause -> clear -> resume`
- `dispatch next` 优先用于“我现在该怎么分发”的场景
- 如果运行时只支持通用 `spawn_agent`，必须走 `spawn_fallback`，不要因为没有自定义 agent 类型就放弃分发
