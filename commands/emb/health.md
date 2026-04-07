---
name: emb-health
description: Check whether the current emb-agent project state is structurally healthy before continuing work.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-health

你负责做一次轻量但可信的项目健康检查。

## 执行规则

1. 直接运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" health`
2. 重点查看：
   - `project.json / hw.yaml / req.yaml` 是否齐全且合法
   - `docs`、文档缓存、adapter 缓存是否存在
   - session / handoff 是否损坏或断链
   - 当前 profile / packs 是否可解析
   - `hw.yaml` 里的 MCU 型号是否已映射到 chip profile
   - 是否已经登记 adapter source
   - 是否已经执行过 `adapter sync`
   - 当前同步结果是否真的命中了项目硬件，而不是停留在全量同步或未匹配状态
   - MinerU API 模式是否缺少 key
3. `health` 是只读自检入口，不要在里面自动改真值层。

## 输出要求

- 先说明整体状态：`pass / warn / fail`
- 明确列出最需要先处理的 `fail` 或 `warn`
- 如果存在 handoff，提醒是否应优先 `resume`
- 如果返回了 `quickstart`，优先按 `quickstart.steps` 执行，这是当前最短闭环
- 如果返回了 `next_commands`，优先执行里面最靠前、最具体的那条 CLI
- 如果存在待应用文档，优先先执行 `ingest apply doc ...`，再回到 `next`
- 如果 `quickstart.stage` 是 `derive-then-next`，说明已有文档足够起草当前芯片 adapter，先执行 `adapter derive --from-project --from-doc <doc-id>`
- 如果状态基本健康，再指出下一步适合走 `next / scan / do / review` 哪条线
