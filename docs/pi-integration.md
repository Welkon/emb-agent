# emb-agent + Pi 集成

## 当前架构

Pi 集成现在是 **extension + native tools + emb-agent-owned subagent dispatcher + session insight** 的统一表面，不依赖第三方 subagent package。

安装后主要文件：

```text
.pi/extensions/emb-agent.ts          # Pi extension：状态栏、上下文注入、三件套 slash 命令、工具注册
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
| `/emb-start` | 加载 `start --brief` 项目上下文，并按 runtime gate 判断是否 onboarding |
| `/emb-next` | 运行 `next --brief` 并把 routing gate 注入对话 |
| `/emb-finish-work` | 记录 workspace journal，并在默认路径下关闭 active task |

文档、手册、datasheet 和原理图不再作为用户 slash 命令暴露。Pi agent 应调用 `ingest_doc` 工具；CLI 场景用 `ingest doc --file <path>` 或 `ingest schematic --file <path>`。

```text
ingest doc --file docs/SC8F072用户手册_V1.0.2.pdf --provider auto --kind datasheet --to hardware
```

## Pi 工具层

Pi extension 注册 LLM 可直接调用的工具：

| 工具 | 作用 |
| --- | --- |
| `emb_start` | 获取 startup/onboarding routing context |
| `emb_next` | 获取 emb-agent 当前 routing gate |
| `emb_finish_work` | 记录 workspace journal 并关闭完成的 active task |
| `emb_subagent` | 在隔离 headless Pi 子进程里运行 emb-agent 原生固件子 agent |
| `emb_session_search` | 搜索本机 Pi/Codex session，用于跨会话记忆 |
| `emb_session_extract` | 抽取本机 session 对话，可按 `all`/`brainstorm`/`implement` 粗切片 |
| `knowledge_search` | 查询 emb-agent 原生项目知识索引，覆盖 truth/PRD/task/wiki/compound/parsed docs |
| `knowledge_diagnose` | 查看知识索引、manifest、embedding cache、stale sources 状态 |
| `knowledge_graph_query` | 查询/解释原生知识图谱中的芯片、寄存器、文档、任务、wiki 关系 |
| `ingest_doc` | 解析/缓存 PDF、manual、datasheet；不要直接 read 原始 PDF |
| `doc_lookup` | 查询已解析文档缓存 |
| `doc_fetch` | 读取已缓存的 parsed markdown；Pi hidden 注入只给 bounded excerpt |
| `ask_user_question` | 用 Pi UI 向用户提结构化问题 |

规则：所有 AI 在读取 firmware/source 文件前，必须先调用 `knowledge_search`（或 CLI `knowledge search --query ... --rerank`）加载项目 truth、需求、历史 PRD/task/wiki、寄存器/外设证据和已知陷阱；如果知识工具不可用、失败、或没有有用命中，才能明确说明 fallback 后退回窄范围 `read`/`rg`。项目知识、设计 rationale、历史 PRD/task/wiki、寄存器/外设证据优先用 `knowledge_search` 或 `knowledge_graph_query`；需要原始文档细节时再用 `doc_lookup` / `doc_fetch` 补源。PDF/手册必须先通过 `ingest_doc` 或 CLI `ingest doc --file <path>`，再用 `doc_fetch` / `doc_lookup` 读取缓存结果。原理图必须走原理图解析：`.SchDoc`/`.sch`/`.dsn`/`.kicad_sch` 使用 `ingest_doc(kind=schematic)` 或 CLI `ingest schematic --file <path>`，之后读取 parsed JSON/advice/preview；不能直接 `read` 或 shell 解析原始原理图。Pi extension 会阻止直接 `read *.pdf` 或用 `cat/strings/xxd` 之类 shell 命令读取原始 PDF，也会阻止直接读取/grep 原始原理图和 `find /`、`rg /` 等无边界全盘搜索。Codex 安装面使用 `.codex/hooks.json` 的 `PreToolUse` 调用 `hook tool-guard --host codex` 执行同一类 knowledge-first/source-read、原理图解析、无界搜索 gate；按 Codex 官方 hook 信任模型，项目 `.codex` hook 必须被信任后才会运行。

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
9. 子代结果通过 `display:false` hidden context 注入，父 agent 只综合结论，不展示原始报告。只有 `succeeded` 角色的正文可作为证据；`cancelled`/`failed` 角色只注入状态摘要，全部失败或取消时不注入综合结果。

默认角色：

- `hw-scout`：硬件事实侦察、引脚/寄存器/手册/原理图约束
- `researcher`：代码、SDK、API、工具链、供应商示例和迁移调研；任务相关结论持久化到 `.emb-agent/tasks/<task>/research/<topic>.md`
- `arch-reviewer`：架构边界、调度/ISR/ROM/RAM 风险、垂直切片
- `sys-reviewer`：需求一致性、低功耗/唤醒/并发/验证顺序
- `bug-hunter`：根因与回归风险追踪
- `fw-doer`：目标任务实现，允许窄范围源码/构建/文档修改
- `release-checker`：独立实现检查、发布前验证、回滚和用户影响检查；只允许自修检查发现的明确小问题，不推进新功能

默认情况下，`hw-scout`、`researcher`、`fw-doer`、`release-checker` 等子 agent 都继承当前 Pi 主会话模型，不额外强制指定模型；这样单模型环境也能运行。只有用户在 `.pi/settings.json` 的 `embAgent.subagentModelRoutes` 中显式配置某个角色模型时，才会给子 Pi 进程传 `--model <name>`。显式模型如果启动失败/不可用，会先重试 3 次，仍失败再 fallback 到 `inherit`；已产生正常工具/输出的实现 run 不会盲目重跑，避免重复写文件。PRD 探索/拆解和宽范围系统工作仍可使用 scout/researcher/reviewer 并行或链式审查；日常单个目标任务实现默认使用链式计划：如果 SDK、工具链、API 或供应商示例证据不足，先由 `researcher` 写入 task `research/` 证据文件，再由 `fw-doer` 完成实现，随后 `release-checker` 做独立检查并自修明确小问题，父 AI 只负责协调、综合隐藏结果、写收尾文档和 `/emb-finish-work`。只有父 AI 判断需要新硬件证据或额外系统审查时，才追加 `hw-scout` / `sys-reviewer` / `arch-reviewer`。进入 work-selection/task-execution 且计划包含实现代理时，Pi guard 会强制父代理先调用一次 `knowledge_search`，再允许 `emb_subagent` 或大范围源码读取；即使没有实现代理，Pi guard 也会在 source read/broad source scan 前要求一次 fresh `knowledge_search`，如果搜索失败或无有用命中则允许 bounded read fallback。`knowledge_search` 会先诊断知识索引，发现缺失/过期/空索引时自动 refresh，并刷新 native graph，`knowledge_graph_query` 也会在查询前刷新图。知识工具和文档工具默认只把 compact evidence、top hits、关键 evidence path、bounded excerpt 注入隐藏上下文；完整 raw hits、整本 parsed markdown、完整 graph JSON 不再默认灌入父上下文。板级事实查询会优先 truth files，跨芯片手册作为参考证据降权。任务收尾和知识沉淀不需要派子 agent：父代理可以直接写 AAR、task 状态、attention、architecture、compound/wiki 和 markdown 文档；只有继续修改源码/构建配置时才受实现 guard 限制。子 agent TUI 进度会显示 spinner、工具数、模型/thinking，以及简洁 context 用量；首跑不显示重试计数，只有实际重试时才显示 `retry 2/4` 这类状态。

低功耗/STOP/current/wake 调试还有额外顺序要求：先证明状态机确实请求 sleep、主循环确实调用 sleep 入口，再判断 `SLEEP/STOP` 指令、RAIF/PEIE/GIE、外设关断或 IO 漏电。推荐用最小 idle-sleep 固件、GPIO 脉冲、断点或电流表 HITL 步骤隔离“没走到入口”和“入口里没睡成”。

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
- `codex.dispatch_mode: inline | auto | sub-agent`

生命周期 hooks 会收到 `TASK_JSON_PATH` 环境变量；session/tool/agent-turn hooks 会收到 `EMB_AGENT_SESSION_EVENT`。任意事件也可通过 `hook event --name <event>` 触发。hook 失败只打印警告，不阻塞主命令。

`max_journal_lines` 限制 `.emb-agent/sessions/journal.jsonl`，并用于 `.emb-agent/workspace/<developer>/journal-N.md` 的 Markdown journal 轮转；`session_auto_commit` 会本地提交 session journal/index，不上传。session memory 默认使用本地 exact + keyword + semantic-hash hybrid scorer；如需外部 embedding，可通过 `EMB_AGENT_EMBEDDING_PROVIDER=openai-compatible`、`EMB_AGENT_EMBEDDING_API_KEY`、`EMB_AGENT_EMBEDDING_MODEL`、`EMB_AGENT_EMBEDDING_API_BASE`、`EMB_AGENT_EMBEDDING_UPLOAD=summary-only|chunks` 显式启用，这些值可来自 shell env、项目 `.env`、`.emb-agent/.env` 或 `EMB_AGENT_ENV_FILE`，失败会回落本地 hash。`mem writeback --target auto` 会按 trap/decision/trick/blocker/requirement 规则晋升到 compound、attention、memory 或手动 PRD/task 指引；`mem promote --query ...` 提供候选晋升 dry-run，只有显式 `--apply` 才写入。`codex.dispatch_mode: auto` 会在宽范围、高风险或研究型固件工作中生成 native Codex subagent 推荐合同并允许 inline fallback；SDK/toolchain/API 实现类合同默认 `researcher -> fw-doer -> release-checker`。`sub-agent` 会返回需要 host-native delegation 的 Codex subagent prompt contract。emb-agent 不用 `codex exec` 代替 native subagent。

## 设置合并

安装器会非破坏性合并 `.pi/settings.json`：

- 保留已有 Pi 设置
- 移除旧的第三方 subagent packages
- 确保 `packages` 默认为空数组，原生分发不依赖 package
- 合并 `embAgent.subagents` 默认值，同时保留用户覆盖
- 合并 `embAgent.subagentModelRoutes` 默认值，同时保留用户覆盖；默认 route 是 `inherit`，不会要求额外模型
- 不写入旧 `subagents.agentOverrides`

## 子 agent 配置

默认配置会让所有子 agent 继承当前 Pi 主模型：

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
      "hw-scout": { "model": "inherit" },
      "release-checker": { "model": "inherit" },
      "arch-reviewer": { "model": "inherit" },
      "bug-hunter": { "model": "inherit" },
      "sys-reviewer": { "model": "inherit" },
      "fw-doer": { "model": "inherit" },
      "onboard": { "model": "inherit" }
    }
  }
}
```

如果你确实有多个可用模型，可以只覆盖需要差异化的角色，例如：

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
