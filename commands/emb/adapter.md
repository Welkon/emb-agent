---
name: emb-adapter
description: Manage external adapter sources, sync vendor/device/chip extensions, and inspect adapter status.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
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
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --from-project
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --from-doc <doc-id> --vendor Padauk
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter generate --from-project --output-root /abs/path/to/emb-agent-adapters
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source remove <name>
```

## Notes

- `adapter derive` 会生成 family/device/chip 草稿与 registry，并按可推断信息补 `device bindings` 的 draft 骨架
- `adapter generate` 复用同一套生成引擎，但允许把结果直接写到任意 `emb-agent` 风格目录；适合 `emb-agent-adapters` 这类贡献仓库
- `adapter derive` 也会为每个 tool 生成 `emb-agent/adapters/routes/<tool>.cjs` draft route；默认仍是 draft 语义
- `timer-calc`、`pwm-calc`、`adc-scale` 和 `comparator-threshold` 例外：生成的 draft route 已带首版通用实现，只要 binding 参数足够即可直接运行
- `adapter derive --from-project` 会从 `emb-agent/hw.yaml` 推断 vendor/model/package、family/device/chip slug、tool 建议和 `pin_count`
- `adapter derive --from-doc <doc-id>` 会从 `emb-agent/cache/docs/<doc-id>/facts.hardware.json` 推断能力，并把文档元数据挂到 chip profile `docs`
- 自动生成的 binding 只会补安全可推断字段，例如 `default_timer`、`default_output_pin`、文档证据和 placeholder params，不会伪造真实公式实现
- 自动推断可被手工参数覆盖，例如先 `--from-doc` 再补 `--vendor` 或直接指定 `--chip`
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
