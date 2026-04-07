---
name: emb-attach
description: Legacy alias of emb-init-project for existing embedded projects.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-attach

这是兼容旧用法的别名。初始化阶段统一优先使用 `$emb-init-project`。

## 执行规则

1. 优先改用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" init`
2. 若必须兼容旧脚本，可运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" attach`
3. 然后读取：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" status`
4. 最后给出：
   - 新生成或复用的 `./.emb-agent/project.json`、`./.emb-agent/hw.yaml`、`./.emb-agent/req.yaml`
   - 检测到的 datasheet / schematic / code / project files
   - 下一步建议使用哪个 emb 命令

## 要求

- 这是兼容别名，不是新的官方初始化入口
- 优先复用仓库内现有代码、手册、原理图和厂商工程文件
- 不引入 phase、roadmap、planning 目录
