# emb-agent + Pi 集成

## 当前架构

Pi 集成现在是 **extension + native tools + emb-agent-owned subagent dispatcher + session insight** 的统一表面，不依赖第三方 subagent package。

安装后主要文件：

```text
.pi/extensions/emb-agent.ts          # Pi extension：状态栏、上下文注入、slash 命令、工具注册
.pi/settings.json                    # Pi settings；embAgent.subagents.runner 默认为 native-pi
.pi/agents/*.md                      # emb-agent agent 定义副本，供人工查看/兼容手动工具
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
| `emb_subagent` | 在隔离 headless Pi 子进程里运行 emb-agent 原生固件子 agent |
| `emb_session_search` | 搜索本机 Pi/Codex session，用于跨会话记忆 |
| `emb_session_extract` | 抽取本机 session 对话，可按 `all`/`brainstorm`/`implement` 粗切片 |
| `ingest_doc` | 解析/缓存 PDF、manual、datasheet；不要直接 read 原始 PDF |
| `doc_lookup` | 查询已解析文档缓存 |
| `doc_fetch` | 读取已缓存的 parsed markdown |
| `ask_user_question` | 用 Pi UI 向用户提结构化问题 |

规则：PDF/手册必须先通过 `ingest_doc` 或 `/emb-ingest`，再用 `doc_fetch` / `doc_lookup` 读取缓存结果。Pi extension 会阻止直接 `read *.pdf` 或用 `cat/strings/xxd` 之类 shell 命令读取原始 PDF。

## 原生子 agent 派发

emb-agent 自动 dispatcher 由 `.pi/extensions/emb-agent.ts` 自己实现：

1. `pi.on("input")` 识别 broad firmware/system-framework 请求。
2. 命中 `delegation_policy.required_before_broad_work` 时，父 agent 会被要求先调用 `emb_subagent`。
3. `emb_subagent` 使用 `pi --mode json -p --no-session` 启动隔离 headless Pi 子进程。
4. 子进程设置 `EMB_AGENT_SUBAGENT_CHILD=1`，防止递归触发自动派发。
5. extension 解析 JSON event stream，显示 native progress card。
6. 全部结果通过 `display:false` hidden context 注入，父 agent 只综合结论，不展示原始报告。

默认只读预检角色：

- `hw-scout`：硬件事实侦察、引脚/寄存器/手册/原理图约束
- `arch-reviewer`：架构边界、调度/ISR/ROM/RAM 风险、垂直切片
- `sys-reviewer`：需求一致性、低功耗/唤醒/并发/验证顺序
- `bug-hunter`：根因与回归风险追踪
- `release-checker`：发布前验证、回滚和用户影响检查

`fw-doer` 和 `onboard` 仍保留模型路由，但自动 broad-work 预检默认只派发只读角色。

## Session Insight

`mem` 是本地 CLI 跨会话记忆底座；`emb_session_search` 和 `emb_session_extract` 是 Pi 内的快捷工具，不依赖 workspace runtime：

- CLI：`mem list`、`mem projects`、`mem search`、`mem context`、`mem extract`、`mem show`、`mem timeline`、`mem related`、`mem summary`、`mem reindex`、`mem stats`、`mem doctor`、`mem prune`、`mem open`、`mem explain`、`mem export`、`mem diff`、`mem writeback`、`mem promote`
- 索引：`.emb-agent/cache/mem/index.json`，本地增量检查，搜索/上下文/show/related 自动重建 stale index
- 搜索根：`~/.claude/projects`、`~/.codex/sessions`、`$PI_CODING_AGENT_SESSION_DIR`、`~/.pi/agent/sessions`
- 输入：关键字或 session id/path
- 输出：清理后的对话片段，默认限制大小，避免把超大 session 直接灌入上下文
- phase：`brainstorm`/`implement`/`review` 使用 emb-agent/task 命令和 PRD/implementation/review 关键词做切片
- Pi：`emb_session_search` / `emb_session_extract` 直接调用 Rust `mem`，不再维护独立 TS 搜索逻辑

适用场景：恢复上次排查、查找某项目之前的架构风险、对照历史 hook/CI 问题、找之前子 agent 给出的证据路径。

## 配置与 Hooks

安装/初始化会创建 `.emb-agent/config.yaml`，用于本地行为开关：

- `session_commit_message`、`max_journal_lines`、`session_auto_commit`
- `hooks.session_start` / `session_end` / `session_compact` / `before_agent_turn` / `after_agent_turn` / `before_tool` / `after_tool` / `after_create` / `after_start` / `after_finish` / `after_archive`
- `channel.worker_guard.idle_timeout` 与 `max_live_workers`
- `codex.dispatch_mode: inline | sub-agent`

生命周期 hooks 会收到 `TASK_JSON_PATH` 环境变量；session/tool/agent-turn hooks 会收到 `EMB_AGENT_SESSION_EVENT`。任意事件也可通过 `hook event --name <event>` 触发。hook 失败只打印警告，不阻塞主命令。

`max_journal_lines` 限制 `.emb-agent/sessions/journal.jsonl`，`session_auto_commit` 会本地提交 session journal/index，不上传。session memory 默认使用本地 exact + keyword + semantic-hash hybrid scorer；如需外部 embedding，可通过 `EMB_AGENT_EMBEDDING_PROVIDER=openai-compatible`、`EMB_AGENT_EMBEDDING_API_KEY`、`EMB_AGENT_EMBEDDING_MODEL`、`EMB_AGENT_EMBEDDING_API_BASE`、`EMB_AGENT_EMBEDDING_UPLOAD=summary-only|chunks` 显式启用，这些值可来自 shell env、项目 `.env`、`.emb-agent/.env` 或 `EMB_AGENT_ENV_FILE`，失败会回落本地 hash。`mem writeback --target auto` 会按 trap/decision/trick/blocker/requirement 规则晋升到 compound、attention、memory 或手动 PRD/task 指引；`mem promote --query ...` 提供候选晋升 dry-run，只有显式 `--apply` 才写入。`codex.dispatch_mode: sub-agent` 会通过 emb-agent 启动本地 `codex exec` worker；不具备 Codex CLI 时返回 manual worker envelope。

## 设置合并

安装器会非破坏性合并 `.pi/settings.json`：

- 保留已有 Pi 设置
- 移除旧的第三方 subagent packages
- 确保 `packages` 默认为空数组，自动派发不依赖 package
- 合并 `embAgent.subagents` 默认值，同时保留用户覆盖
- 合并 `embAgent.subagentModelRoutes` 默认值，同时保留用户覆盖
- 不写入旧 `subagents.agentOverrides`

## 子 agent 配置

用户可编辑 `.pi/settings.json`：

```json
{
  "packages": [],
  "embAgent": {
    "subagents": {
      "dispatchMode": "auto",
      "runner": "native-pi",
      "maxParallel": 3,
      "resultVisibility": "hidden-summary",
      "rawResultGuardMs": 60000
    },
    "subagentModelRoutes": {
      "hw-scout": { "model": "deepseek/deepseek-v4-flash", "thinking": "off" },
      "arch-reviewer": { "model": "deepseek/deepseek-v4-pro", "thinking": "high" },
      "sys-reviewer": { "model": "deepseek/deepseek-v4-pro", "thinking": "high" },
      "fw-doer": { "model": "custom/gpt-5.5", "thinking": "xhigh" }
    }
  }
}
```

关闭自动派发：

```json
{ "embAgent": { "subagents": { "dispatchMode": "off" } } }
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
2. 确认 `.pi/settings.json` 的 `embAgent.subagents.runner` 是 `native-pi`。
3. 重启 Pi 会话或执行 `/reload`。
4. 确认 runtime wrapper 存在于 `.pi/emb-agent/bin/emb-agent.cjs` 或全局 Pi runtime 路径。
