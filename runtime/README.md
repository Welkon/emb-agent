# emb-agent runtime

这是安装到宿主配置目录下的 emb-agent 运行时本体。
当前正式支持 `Codex` 与 `Claude Code`。

## 宿主约定

- `Codex`
  - `runtime-home = ~/.codex`
  - `host-config = config.toml`
- `Claude Code`
  - `runtime-home = ~/.claude`
  - `host-config = settings.json`

统一运行入口：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs
```

统一脚本入口：

```bash
node <runtime-home>/emb-agent/scripts/init-project.cjs
```

项目状态默认写到：

```text
<runtime-home>/state/emb-agent/projects/
```

## 目录职责

- `bin/`
  主 CLI 入口。
- `hooks/`
  宿主 hook 脚本，例如 `SessionStart` 和上下文卫生提醒。
- `lib/`
  runtime 内部库，包括 session、handoff、调度、dispatch、host/path 解析。
- `scripts/`
  runtime 辅助脚本，例如 `init-project`、`attach-project`、`ingest-doc`、`adapter-derive`。
- `templates/`
  固定输出模板。
- `profiles/`
  内置项目画像。
- `packs/`
  内置场景 pack。
- `tools/`
  core 抽象工具 spec。
- `chips/`
  core 抽象 chip registry。
- `extensions/`
  可选扩展根目录；仅在 `adapter sync`、`adapter derive`、`template fill` 或首次写扩展 registry 时创建。
- `state/default-session.json`
  默认 session 模板。
- `config.json`
  runtime 默认配置。
- `HOST.json`
  安装时写入的宿主元数据，供运行时解析真实 host/path。
- `VERSION`
  已安装 runtime 版本。

## 最小维护命令

初始化或接入项目：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs init
node <runtime-home>/emb-agent/bin/emb-agent.cjs health
node <runtime-home>/emb-agent/bin/emb-agent.cjs next
node <runtime-home>/emb-agent/bin/emb-agent.cjs dispatch next
```

如果是外设公式、引脚或寄存器定位问题，优先看 `next` / `dispatch next` 里是否已经给出 `tool_recommendation` 或 `tool_execution`。

上下文收口：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs pause
node <runtime-home>/emb-agent/bin/emb-agent.cjs resume
```

查看运行时更新状态：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs update
```

查看 runtime 帮助：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs help
```

## 维护边界

- 这里是安装态 runtime，不是项目交付物。
- 项目侧可变内容应写回仓库内的 `./emb-agent/` 与 `./docs/`。
- 宿主相关差异优先放进 `HOST.json + runtime-host.cjs`，不要重新散落写死 `~/.codex` 或 `~/.claude`。
- 用户流程说明优先放主 [README](../README.md) 和安装后的 `emb-help`，这里不要再复制一整份用户手册。
