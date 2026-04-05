---
name: emb-adapter
description: Manage external adapter sources, sync vendor/device/chip extensions, and inspect adapter status.
---

# emb-adapter

Use this command when the project needs concrete tool adapters instead of abstract-only tool specs.

## When To Use

- 需要把厂商/芯片工具扩展接入当前项目
- 需要同步外部 adapter 仓库到项目 `emb-agent/` 目录
- 需要确认某个 adapter source 是否已经同步
- 需要移除旧的 adapter source 并清理已同步产物

## Runtime

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter status
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter status <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source list
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source show <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source add <name> --type path --location /abs/path/to/adapter-source
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source add <name> --type git --location <git-url-or-local-repo> [--branch main] [--subdir emb-agent]
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync <name> --to runtime
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync --all
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --family vendor-family --device vendor-device --chip vendor-chip --tool timer-calc --package sop8 --pin-count 8
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source remove <name>
```

## Notes

- `adapter derive` 只生成 family/device/chip 草稿与 registry，不会伪造 bindings 参数
- `chip profile` 现在建议把封装与引脚知识放进 `packages` / `pins`
- `adapter source add` 只写入 `emb-agent/project.json`，不会自动同步
- `adapter sync` 才会真正把 adapter/profile 文件铺到项目或 runtime
- `--to project` 是默认值，适合项目私有扩展
- `--to runtime` 适合团队共用扩展，但要注意 runtime 目录会被更新
- path 源支持直接读取本地目录
- git 源会缓存到 `cache/adapter-sources/`，然后再同步到目标目录
- source 根目录支持两种布局：
  - 直接包含 `adapters/` 和 `extensions/`
  - 仓库根下再包一层 `emb-agent/`
- `adapter source remove` 会同时清理对应 source 曾同步到 `project/runtime` 的已跟踪文件
