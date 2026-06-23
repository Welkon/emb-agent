# emb-agent + Pi 集成

## 当前架构

Pi 集成现在是 **extension + tools + Tintinweb Agent subagents** 的统一表面，不再只是复制 agent 文件。

安装后主要文件：

```text
.pi/extensions/emb-agent.ts          # Pi extension：状态栏、上下文注入、slash 命令、工具注册
.pi/settings.json                    # Pi package/settings；必须包含 npm:@tintinweb/pi-subagents
.pi/agents/*.md                      # Tintinweb Agent 可发现的 emb-agent 子 agent
.pi/skills/emb-agent/SKILL.md        # Pi 可加载的 emb-agent skill
.pi/emb-agent/bin/emb-agent.cjs      # 项目本地 runtime wrapper
```

全局安装时 runtime 也可能在：

```text
~/.pi/agent/emb-agent/bin/emb-agent.cjs
$PI_CODING_AGENT_DIR/emb-agent/bin/emb-agent.cjs
```

Pi extension 会按本地、全局、环境变量顺序解析 runtime。

## 安装

```bash
npx emb-agent@latest --target pi --local
```

安装或更新后重启 Pi 会话，或在支持时执行 `/reload`。

## Pi Slash 命令

| 命令 | 作用 |
| --- | --- |
| `/emb-next` | 运行 `next --brief` 并把 routing gate 注入对话 |
| `/emb-onboard` | 运行 onboarding handoff |
| `/emb-ingest doc --file <path> ...` | 解析/缓存 PDF、手册、datasheet 或其它文档 |

PDF 示例：

```text
/emb-ingest doc --file docs/SC8F072用户手册_V1.0.2.pdf --provider auto --kind datasheet --to hardware
```

## Pi 工具层

Pi extension 注册 LLM 可直接调用的工具：

| 工具 | 作用 |
| --- | --- |
| `emb_next` | 获取 emb-agent 当前 routing gate |
| `emb_onboard` | 获取 onboarding handoff |
| `ingest_doc` | 解析/缓存 PDF、manual、datasheet；不要直接 read 原始 PDF |
| `doc_lookup` | 查询已解析文档缓存 |
| `doc_fetch` | 读取已缓存的 parsed markdown |
| `ask_user_question` | 用 Pi UI 向用户提结构化问题 |

规则：PDF/手册必须先通过 `ingest_doc` 或 `/emb-ingest`，再用 `doc_fetch` / `doc_lookup` 读取缓存结果。Pi extension 会阻止直接 `read *.pdf` 或用 `cat/strings/xxd` 之类 shell 命令读取原始 PDF。

## 子 agent

Pi 通过 `npm:@tintinweb/pi-subagents` 提供 Claude Code 风格 `Agent` 工具，并发现 `.pi/agents/*.md`。emb-agent 会同步这些 agent，并在 broad firmware/system-framework 请求命中 `delegation_policy` 时通过 `subagents:rpc:spawn` 自动启动只读预检子 agent：

- `hw-scout`：硬件事实侦察，默认只读
- `bug-hunter`：根因追踪，默认只读/命令
- `fw-doer`：实现修改，允许 `edit/write`
- `arch-reviewer` / `sys-reviewer` / `release-checker`：审查，默认不写项目文件
- `onboard`：初始化/迁移，允许 `edit/write`

emb-agent 会在 `.pi/settings.json` 的 `embAgent.subagentModelRoutes` 中写入可编辑的默认模型路由；用户可以按项目覆盖。生成 `.pi/agents/*.md` 和自动 `subagents:rpc:spawn` 时都会使用这些路由；如果指定模型不可用，自动 spawn 会不带模型重试并继承主会话模型。

## 设置合并

安装器会非破坏性合并 `.pi/settings.json`：

- 保留已有 packages 和其它 Pi 设置
- 确保 `npm:@tintinweb/pi-subagents` 存在
- 移除旧的 `npm:pi-subagents`，避免两套 subagent 工具同时暴露
- 合并 `embAgent.subagentModelRoutes` 默认值，同时保留用户覆盖
- 不写入旧 `subagents.agentOverrides`；Tintinweb Agent 读取 `.pi/agents/*.md` frontmatter 和 RPC spawn 参数

## 子 agent 模型路由

用户可编辑 `.pi/settings.json`：

```json
{
  "embAgent": {
    "subagentModelRoutes": {
      "hw-scout": { "model": "deepseek/deepseek-v4-flash", "thinking": "off" },
      "arch-reviewer": { "model": "deepseek/deepseek-v4-pro", "thinking": "high" },
      "sys-reviewer": { "model": "deepseek/deepseek-v4-pro", "thinking": "high" },
      "fw-doer": { "model": "custom/gpt-5.5", "thinking": "xhigh" }
    }
  }
}
```

把某个 agent 设为继承主会话模型：

```json
{ "embAgent": { "subagentModelRoutes": { "hw-scout": "inherit" } } }
```

## 排查

```bash
node .pi/emb-agent/bin/emb-agent.cjs next --brief
node .pi/emb-agent/bin/emb-agent.cjs diagnostics hooks --host pi --json
```

如果 slash 命令或工具不可见：

1. 确认 `.pi/extensions/emb-agent.ts` 存在。
2. 确认 `.pi/settings.json` 包含 `npm:@tintinweb/pi-subagents`，且不再包含旧 `npm:pi-subagents`。
3. 重启 Pi 会话或执行 `/reload`。
4. 确认 runtime wrapper 存在于 `.pi/emb-agent/bin/emb-agent.cjs` 或全局 Pi runtime 路径。
