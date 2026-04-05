---
name: emb-template
description: List, preview, and fill emb-agent templates like the GSD template subsystem, but for embedded workflows.
---

# emb-template

你负责使用 emb-agent 的模板子系统。

## 执行规则

1. 直接使用安装后的 runtime 模板系统：
   - `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" template list`
   - `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" template show <name>`
   - `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" template fill <name> --field KEY=VALUE`
2. 模板只服务嵌入式工作流，不生成厚 planning 工件。

## 当前模板类型

- `architecture-review`
- `hardware-logic`
- `debug-notes`
- `review-report`
- `connectivity`
- `release-notes`
- `profile`
- `pack`

## 输出要求

- 说明用了哪个模板
- 说明生成到了哪个路径
- 若字段仍未补全，明确指出还需要哪些 `--field`
