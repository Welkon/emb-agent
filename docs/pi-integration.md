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

emb-agent 的 Pi 分发层由 `.pi/extensions/emb-agent.ts` 自己实现。它不靠中文/英文关键词猜用户意图，而是先根据 emb-agent runtime 的结构化协议生成 `SubagentDispatchPlan`，再让父 AI 决定是否调用 `emb_subagent`：

1. extension 读取 `agent_protocol.gate.kind`、`action`、`task_candidates`、`delegation_policy` 生成 dispatch plan：`phase`、`targetTask`、`mode`、`runs[]`。
2. `work-selection` / `task-execution` 的候选任务会先被排序成具体目标（优先未完成、低 priority 数字、数字前缀靠前、候选顺序靠前），而不是一次吞掉全部任务。
3. `prd-exploration` 和 `prd-breakdown` 默认只给出只读证据/审查计划；实现子代等到具体 target task 后再运行。
4. 父 AI 根据用户当前话语判断是否是实现/继续/启动意图；若是，则必须先调用 `emb_subagent`，不能父线程直接写文件。
5. extension 在需要 delegation 的结构化 gate 下会拦截父线程的 `write`/`edit` 以及明显写入型 shell 命令，防止绕过子代。
6. `emb_subagent` 使用 `pi --mode json -p --no-session` 启动隔离 headless Pi 子进程。
7. 子进程设置 `EMB_AGENT_SUBAGENT_CHILD=1`，防止递归触发。
8. extension 解析 JSON event stream，显示 native progress card。
9. 子代结果通过 `display:false` hidden context 注入，父 agent 只综合结论，不展示原始报告。

默认只读预检角色：

- `hw-scout`：硬件事实侦察、引脚/寄存器/手册/原理图约束
- `arch-reviewer`：架构边界、调度/ISR/ROM/RAM 风险、垂直切片
- `sys-reviewer`：需求一致性、低功耗/唤醒/并发/验证顺序
- `bug-hunter`：根因与回归风险追踪
- `release-checker`：发布前验证、回滚和用户影响检查

`fw-doer` 和 `onboard` 仍保留模型路由。PRD 探索阶段默认只给出只读角色计划；当父 AI 判断用户意图是实现/继续/启动候选任务时，调用 `emb_subagent` 会使用链式计划：可选 `hw-scout` 先做目标任务证据确认，`fw-doer` 只实现选中的目标 task，`release-checker` 做验收/缺口检查。

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
- 确保 `packages` 默认为空数组，原生分发不依赖 package
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

关闭分发守卫：

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
