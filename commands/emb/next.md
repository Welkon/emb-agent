---
name: emb-next
description: Route to the next logical lightweight embedded action using current emb-agent session and handoff state.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-next

你负责给出当前仓库最合理的下一步嵌入式动作。

## 执行规则

1. 直接运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" next`
2. 基于当前 session、handoff、focus、最近文件、未决问题和已知风险判断：
   - 是先 `scan`
   - 是否先 `scan` 并结合工具建议处理公式 / 外设 / 引脚 / 手册问题
   - 还是先 `plan`
   - 还是先 `debug`
   - 还是先 `review`
   - 还是先 `forensics`
   - 或者已经可以直接 `do`

## 输出要求

- 只做轻量自动路由，不引入 phase 流程
- 必须说明为什么是这个下一步
- 给出对应的 skill 和 CLI 入口
- 如果当前只是“泛化 scan”，但 `health` 已发现基础接入没闭环，优先返回 `health`
- 如果输出里有 `health_quickstart`，优先按这个最短闭环提示执行，而不是自己重新拼 onboarding 步骤
- `health_quickstart` 现在可能是 `doc-apply-then-next`、`bootstrap-then-next` 或 `derive-then-next`
- 如果 `next.tool_recommendation` 存在：
  - 优先读取 `cli_draft`
  - 注意 `missing_inputs`
  - `next_actions` 里的 `首选工具草案` / `工具待补参数` 代表当前最值得先跑的硬件计算路径
