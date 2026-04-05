---
name: emb-scan
description: Run the lightweight embedded scan flow using installed emb-agent context for the current repository.
---

# emb-scan

你负责按 emb-agent 的轻量扫描方式收集上下文。

## 执行规则

1. 先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" resume`
2. 然后按当前项目画像做扫描：
   - 代码入口
   - 硬件真值来源
   - 协议或状态机实现
   - 最近文件与未决问题相关位置
3. 读取 `scan` 输出里的 `agent_execution` 和 `dispatch_contract`。
4. 如果 `agent_execution.recommended = true`：
   - 优先调用 `dispatch_contract.primary.agent`
   - 若当前运行时不能直接调用已安装 agent，则按 `dispatch_contract.primary.spawn_fallback` 改用通用 `spawn_agent`
   - 只有 `dispatch_contract.supporting` 里明确适合并行的只读 agent，才允许并行展开
   - 主线程继续整合，不要空等全部子 agent
5. 如需直接沉淀扫描结果，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" scan save <target> <summary> --fact <text> --question <text> --read <text>`
6. 输出：
   - Relevant files
   - Key facts
   - Open questions
   - Next reads
   - Agent execution

## 要求

- 先读真值来源，再下结论
- 对嵌入式项目优先关注引脚、寄存器、时序、共享状态
- scan 默认仍然轻量；没有明确收益时不要为了“像 GSD”而强行起子 agent
- 如果 `agent_execution.recommended = true`，不要只把建议打印出来，要真的发起对应子 agent
- 结果可直接沉到 `docs/HARDWARE-LOGIC.md` 或 `docs/DEBUG-NOTES.md`
