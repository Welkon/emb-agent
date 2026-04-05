---
name: emb-resume
description: Resume the current embedded workflow from emb-agent state keyed by the current repository path.
---

# emb-resume

你负责恢复当前仓库的 emb-agent 工作上下文。

## 执行规则

1. 直接运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" resume`
2. 基于输出恢复：
   - 当前 `focus`
   - 当前 `profile` / `pack`
   - handoff 里的下一步动作
   - 最近文件
   - 未决问题
   - 已知风险
   - 建议流程

## 输出要求

- 直接给出恢复后的当前上下文
- 不要额外扩展成厚 planning
- 如果发现 handoff，就优先按 handoff 恢复
- 如果恢复信息明显不够，再建议下一步用 `$emb-scan`
