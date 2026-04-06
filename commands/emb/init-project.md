---
name: emb-init-project
description: Initialize emb-agent for the current project with one command, creating lightweight project context without a project-local runtime.
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - SlashCommand
---

# emb-init-project

你负责用唯一初始化入口把当前仓库接成 emb-agent 可工作的项目。

最短流程：

1. 第一次进入项目：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" init`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" next`
2. 后续继续当前项目：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" next`
3. 需要导入手册/PDF：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" ingest doc --file <path> --provider mineru --kind datasheet --to hardware`

## 执行规则

1. 不要创建 `./.emb-agent/` 这类项目私有 runtime。
2. 运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" init`
3. 如已知信息明确，可补：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" init --mcu <name> --board <name> --goal <text>`
4. 然后读取：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" status`
5. 返回：
   - 已创建哪些内容
   - 检测到的 datasheet / schematic / code / project files
   - 当前默认 `profile` / `pack`
   - 当前项目级默认 `preferences`
   - 当前生效的 `arch_review_triggers`
   - 下一步建议使用哪个 emb 命令

## 要求

- 不引入 phase、roadmap、planning 目录
- 保持轻量
- 若项目内生成了 `./emb-agent/`，它只应包含项目配置、真值层、缓存和轻量扩展，而不是整套 runtime

默认会创建这些目录或文件：

- `docs/`
- `emb-agent/project.json`
- `emb-agent/hw.yaml`
- `emb-agent/req.yaml`
- `emb-agent/cache/docs/`
- `emb-agent/profiles/`
- `emb-agent/packs/`
- `emb-agent/adapters/`
- `emb-agent/extensions/tools/specs/`
- `emb-agent/extensions/tools/families/`
- `emb-agent/extensions/tools/devices/`
- `emb-agent/extensions/chips/profiles/`

覆盖规则：

- 默认不覆盖已有 `docs/*.md` 和已存在的项目文件
- 只有显式传 `--force` 时，模板输出才会重写
