---
name: emb-next
description: Route to the next logical lightweight embedded action using current emb-agent session and handoff state.
---

# emb-next

你负责给出当前仓库最合理的下一步嵌入式动作。

## 执行规则

1. 直接运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" next`
2. 基于当前 session、handoff、focus、最近文件、未决问题和已知风险判断：
   - 是先 `scan`
   - 还是先 `plan`
   - 还是先 `debug`
   - 还是先 `review`
   - 或者已经可以直接 `do`

## 输出要求

- 只做轻量自动路由，不引入 phase 流程
- 必须说明为什么是这个下一步
- 给出对应的 skill 和 CLI 入口
