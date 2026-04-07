---
name: emb-task
description: Manage lightweight task-local context so embedded work can resume with precise file scopes after context clears.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-task

你负责管理轻量 task 上下文。

- 一个 task 对应一个明确问题或功能块
- task 自带局部上下文文件
- task 创建时会自动吸收当前可用的 docs / tool 推荐 / adapter 命中信息
- clear context 之后，agent 可以更快接回，不必重新扫描全部项目

## 适用场景

- 某个外设块需要跨会话推进，例如 `IR decode`、`TM2 PWM`、`Comparator threshold`
- 某个芯片适配或 adapter 推导需要单独追踪
- 某个 board bring-up / pinmux / timing 问题需要固定上下文

## Runtime

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs task list
node ~/.codex/emb-agent/bin/emb-agent.cjs task add <summary> [--type implement|debug|review|investigate]
node ~/.codex/emb-agent/bin/emb-agent.cjs task show <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs task activate <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs task resolve <name> [note]
node ~/.codex/emb-agent/bin/emb-agent.cjs task context list <name> [implement|check|debug|all]
node ~/.codex/emb-agent/bin/emb-agent.cjs task context add <name> <implement|check|debug> <path> [reason]
```

## 规则

1. 不把 task 变成 phase / roadmap / 厚 planning。
2. task 只服务于“缩小上下文、固定相关文件、方便 resume”。
3. 优先把 `hw.yaml / req.yaml / 当前相关代码 / 当前相关文档` 放进 task context。
4. 如果 task 已经是当前主线，执行 `task activate <name>`，让 `resume / next / session start hook` 自动带出它。

## 输出要求

- 说明你创建、激活、查看或关闭了哪个 task
- 说明 task 当前目标是什么
- 如果需要继续推进，直接指出 task context 中最该先读的文件
