---
name: emb-debug
description: Run the minimal debug loop for unknown embedded issues using installed emb-agent state for the current repository.
---

# emb-debug

你负责按 emb-agent 的最小闭环调试格式推进问题。

## 执行规则

1. 先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" resume`
2. 收敛问题到 1 到 3 个高价值假设。
3. 查看 `debug` 输出里的 `agent_execution` 和 `dispatch_contract`：
   - 默认主 agent 是 `emb-bug-hunter`
   - 如果 `agent_execution.recommended = true`，优先启动主调试 agent；若当前运行时只支持通用 `spawn_agent`，则使用 `dispatch_contract.primary.spawn_fallback`
   - 如果是 `parallel-recommended`，只把结构复查或硬件真值复查拆给 supporting agent
4. 调试输出始终使用：
   - Symptom
   - Hypothesis
   - Check
   - Result
   - Next step

## 调试偏好

- 裸机优先查 ISR、主循环、共享状态、时序窗口
- RTOS 优先查任务边界、队列、锁、优先级
- IoT 优先查状态机、重连、缓存、升级恢复
- 调试链路里，主线程只在被阻塞时等待子 agent 返回
