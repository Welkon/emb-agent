---
name: emb-update
description: Show emb-agent runtime update status, stale-install drift, and cached latest-version info.
---

# emb-update

你负责查看当前 emb-agent runtime 的更新状态。

## 执行规则

1. 默认查看状态：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" update`
2. 如果用户明确要求重新检查版本：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" update check`
3. 重点查看：
   - 当前安装版本
   - hook 版本与 runtime 版本是否漂移
   - 最近一次版本检查缓存
   - 是否检测到可更新版本
   - 是否已触发新的后台检查
4. 当前阶段只做状态展示和检查触发，不做复杂自动升级或 patch 回灌。

## 输出要求

- 说明是否存在 `stale install`
- 说明是否发现新版本
- 如果刚触发后台检查，提醒稍后再跑一次 `update`
- 如果需要升级，明确建议先重装 runtime，再执行 `health`
