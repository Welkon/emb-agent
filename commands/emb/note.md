---
name: emb-note
description: Record long-lived embedded conclusions into fixed project notes using installed emb-agent context.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-note

你负责把长期有效的技术结论写入固定文档。

## 执行规则

1. 先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" note targets`
2. 如果 `note` 输出里的 `agent_execution.recommended = true`，优先调用 `dispatch_contract.primary.agent`；若当前运行时只支持通用 `spawn_agent`，则按 `dispatch_contract.primary.spawn_fallback` 补齐真值或发布约束，再落文档。
3. 如需直接落文档，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" note add <target> <summary> --kind <kind> --evidence <text>`
4. 只记录这些适合长期保留的内容：
   - 硬件真值
   - bring-up 结论
   - 已知限制
   - 调试结论
   - 联网与发布约束
5. 不记录：
   - 临时猜测
   - 会话碎片
   - phase / planning 过程

## 输出要求

- 说明写入了哪个文档
- 说明依据是什么
- 标注哪些仍未验证

## 目标别名

- `hardware` -> `docs/HARDWARE-LOGIC.md`
- `debug` -> `docs/DEBUG-NOTES.md`
- `connectivity` -> `docs/CONNECTIVITY.md`
- `release` -> `docs/RELEASE-NOTES.md`
