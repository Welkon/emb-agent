---
name: emb-session-report
description: Write a lightweight session report so the current embedded work state can be audited and resumed later.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-session-report

你负责把当前 emb-agent 会话压成一份轻量 session report。

## 执行规则

1. 直接运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" session-report [summary]`
2. session report 应覆盖：
   - 当前 profile / packs / preferences
   - 当前 focus、最近文件、未决问题、已知风险
   - 如果存在活跃 workspace，也要写入它的 `refreshed_at / link_counts / snapshot_counts`
   - 是否存在 handoff
   - 当前 threads 概况
   - 下一步推荐命令与建议流程
   - 如果已有首选 tool，也要写入 `tool_recommendation / tool_status / tool_cli / tool_missing_inputs`
3. 结果应落到项目内 report 目录，方便下次 resume 前快速回读。

## 输出要求

- 说明写入了哪个 report 文件
- 给出当前最重要的下一步
- 不要生成厚 planning
