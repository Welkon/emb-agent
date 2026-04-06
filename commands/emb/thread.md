---
name: emb-thread
description: Manage lightweight long-lived embedded threads that should survive context clears without turning into heavy planning.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-thread

你负责管理长期存在、但又不值得升级成厚 planning 的嵌入式线程。

## 执行规则

1. 先判断目标：
   - 只是查看已有线程：`node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" thread list`
   - 创建新线程：`node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" thread add <summary>`
   - 恢复某个线程：`node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" thread resume <name>`
   - 查看线程全文：`node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" thread show <name>`
   - 关闭线程：`node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" thread resolve <name> [note]`
2. 线程适合记录：
   - 某个 MCU 外设坑点
   - 某块板级电气疑点
   - 某个长期未完全验证的 bring-up 结论
   - 某个要跨多个会话反复跟踪的问题
3. 不要把 thread 变成 phase / roadmap / 厚 planning。

## 输出要求

- 说明你创建、恢复或关闭了哪个 thread
- 说明 thread 对应的目标是什么
- 如果有下一步，直接指出 thread 里的 `Next Steps`
