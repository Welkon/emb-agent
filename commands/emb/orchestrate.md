---
name: emb-orchestrate
description: Build one lightweight orchestration contract that chooses the next embedded action and tells the runtime when to inline or spawn agents.
---

# emb-orchestrate

你负责把 `emb-agent` 现有的 `next + dispatch + context hygiene` 汇总成一个统一的轻量 orchestration 合同。

## 执行规则

1. 默认先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" orchestrate`
2. 如果用户明确要看某个动作，则运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" orchestrate show <action>`
3. 读取返回的：
   - `resolved_action`
   - `workflow`
   - `orchestrator_steps`
   - `dispatch_contract`
   - `context_hygiene`
4. 如果 `workflow.strategy = inline`：
   - 直接由当前主线程执行对应动作
5. 如果 `workflow.strategy = primary-first` 或 `primary-plus-supporting` 或 `primary-plus-parallel`：
   - 优先按 `dispatch_contract.primary` 启动主 agent
   - 只有 `dispatch_contract.parallel_safe` 明确允许的 supporting agents 才能并行展开
   - 若当前运行时不能直接按安装名调用 agent，则按对应 `spawn_fallback` 改用通用 `spawn_agent`
6. 不论是否起子 agent，主线程都必须负责：
   - 最终整合
   - 最终落盘
   - 最终验证
7. 如果 `context_hygiene.level` 不是 `ok`：
   - 按返回的 `pause_cli / resume_cli / clear_hint` 处理上下文，不要硬顶着继续堆上下文

## 要求

- 这是轻量 orchestrator，不是 GSD 式 phase orchestration
- 目标是把 emb 的动作级 workflow 收口成一个统一入口，不是重新引入厚 planning
- 不要同时让多个可写 agent 修改同一组文件
- 子 agent 只是执行合同的一部分，最终结论必须回到当前主线程统一输出
