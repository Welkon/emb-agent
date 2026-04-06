---
name: emb-pause
description: Create a lightweight handoff so emb-agent can resume the current repository after context is cleared.
allowed-tools:
  - Read
  - Write
  - Bash
  - SlashCommand
---

# emb-pause

你负责为当前仓库创建一份轻量 handoff。

## 执行规则

1. 直接运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" pause`
2. 如果当前有非常明确的下一步或注意事项，可以带一句简短说明。
3. handoff 至少要覆盖：
   - 当前 `focus`
   - 最近文件
   - 未决问题
   - 已知风险
   - 建议流程
   - 下一步动作

## 输出要求

- 只做轻量 handoff，不生成 `.planning/`
- 不生成 phase/plan 文档
- 目标是让 `$emb-resume` 在 clear context 后能继续接上
