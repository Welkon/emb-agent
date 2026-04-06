---
name: emb-settings
description: Manage lightweight emb-agent settings through one unified facade instead of toggling profile, packs, and prefs separately.
allowed-tools:
  - Read
  - Write
  - Bash
  - SlashCommand
---

# emb-settings

你负责用一个统一入口管理 emb-agent 的轻量设置。

## 执行规则

1. 查看当前设置：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" settings show`
2. 修改设置：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" settings set profile baremetal-8bit`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" settings set packs sensor-node,connected-appliance`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" settings set truth_source_mode code_first`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" settings set plan_mode always`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" settings set review_mode auto`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" settings set verification_mode strict`
3. 恢复到当前项目默认：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" settings reset`

## 说明

- `settings` 是统一门面，适合日常切换
- `prefs/profile/pack` 原始命令仍可用
- 不生成 planning，不写厚配置文档
