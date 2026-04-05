# emb-agent

把 `emb-agent` 做成和 `get-shit-done` 同类的安装系统，而不是一个单独 skill。

## 这版定位

- 源仓库是 installer-first
- 包名和入口不再绑定 `codex`
- 对 Codex 的安装目标仍然是 `~/.codex/` 或 `./.codex/`
- runtime 直接安装在 `.codex/emb-agent/`
- 不再依赖项目内 `./.emb-agent/` 私有 runtime

实现路线见 [ROADMAP.md](./ROADMAP.md)。
当前已支持轻量 `micro-plan`，不是 GSD 式厚 `planning`。
发布流程见 [RELEASE.md](./RELEASE.md)。

## 仓库结构

- `bin/install.js`: 安装器入口
- `commands/emb/`: 源命令定义
- `agents/`: 源 agent 定义
- `runtime/`: 安装到 runtime 目录的核心内容
- `runtime/bin/emb-agent.cjs`: 主 CLI
- `runtime/config.json`: runtime 默认配置
- `runtime/lib/`: 统一校验与状态工具
- `runtime/templates/`: 类似 GSD 的扁平模板库
- `runtime/profiles/`: 内置项目画像
- `runtime/packs/`: 内置场景 pack
- `runtime/tools/`: 抽象 calculator spec 与空 registry
- `runtime/chips/`: 抽象 chip registry 与空 profile 入口

注意：

- `emb-agent` 是通用嵌入式 agent 框架，不绑定任何厂商工具、MCU 家族或固定手册
- core 只内置抽象工具规格，不内置 `family / device / chip` profile，也不内置任何 calculator 实现
- 如果项目需要厂商或芯片绑定，应通过外部 adapter/profile 扩展，而不是写进 emb core

## 安装

这套仓库现在是 installer-first，使用方式参考 GSD。对于 Codex，安装目标就是 `.codex`。

### 全局安装

```bash
npx emb-agent --global
```

默认目标目录：

```text
~/.codex/
```

### 本地安装

```bash
npx emb-agent --local
```

默认目标目录：

```text
./.codex/
```

### 自定义目录

```bash
npx emb-agent --global --config-dir /path/to/codex-home
```

### 从 git 仓库直接安装

如果把这个目录单独放到 git 仓库里，安装形态就是：

```bash
npx github:<you>/emb-agent --global
```

或者：

```bash
npx git+https://github.com/<you>/emb-agent.git --global
```

如果只是当前工作区本地验证，可以直接：

```bash
npx ./emb-agent --global
```

## 安装结果

安装后会生成这些内容：

```text
<codex-dir>/
├── skills/
│   ├── emb-help/
│   ├── emb-init-project/
│   ├── emb-next/
│   ├── emb-pause/
│   ├── emb-resume/
│   ├── emb-scan/
│   ├── emb-plan/
│   ├── emb-arch-review/
│   ├── emb-do/
│   ├── emb-debug/
│   ├── emb-review/
│   ├── emb-note/
│   ├── emb-prefs/
│   └── emb-template/
├── agents/
│   ├── emb-hw-scout.toml
│   ├── emb-fw-doer.toml
│   ├── emb-bug-hunter.toml
│   ├── emb-arch-reviewer.toml
│   ├── emb-sys-reviewer.toml
│   └── emb-release-checker.toml
├── emb-agent/
│   ├── bin/
│   ├── scripts/
│   ├── templates/
│   ├── profiles/
│   ├── packs/
│   ├── tools/
│   ├── chips/
│   ├── adapters/
│   ├── extensions/
│   ├── state/
│   ├── commands/
│   └── agents/
└── config.toml
```

安装时还会补一个 `.env.example`：

- 全局安装落在 `~/.codex/.env.example`
- 本地安装落在当前项目根目录 `./.env.example`

这层结构更接近 GSD：

- 模板文件直接平铺在 `emb-agent/templates/`
- profile 和 pack 直接在 `emb-agent/profiles/`、`emb-agent/packs/`
- 不再有 `template/.emb-agent/` 这种嵌套 runtime 模型
- `templates/` 下不再按 `docs/`、`profiles/`、`packs/` 再分桶

## 典型使用

最短流程：

```bash
# 第一次进入项目
node ~/.codex/emb-agent/bin/emb-agent.cjs init
node ~/.codex/emb-agent/bin/emb-agent.cjs next

# 后续继续当前项目
node ~/.codex/emb-agent/bin/emb-agent.cjs next

# 需要导入手册/PDF
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU-datasheet.pdf --provider mineru --kind datasheet --to hardware
```

安装后，默认只需要记这组命令：

## Basic

- `$emb-help`
- `$emb-init-project`
- `$emb-next`
- `$emb-ingest`
- `$emb-scan`
- `$emb-plan`
- `$emb-do`
- `$emb-debug`
- `$emb-review`
- `$emb-dispatch`
- `$emb-arch-review`
- `$emb-pause`
- `$emb-resume`

这一层的用法：

- `$emb-init-project` 是唯一官方初始化入口，会生成项目级默认配置、真值层、固定文档骨架，并自动探测已有厂商 IDE / SDK / brownfield 工程里的首批资料来源，但不创建 `./.emb-agent/` 这类私有 runtime
- `$emb-next` 是默认入口。大多数时候不用先想命令，直接从它开始
- `$emb-ingest` 用于把后续读到并确认的硬件/需求事实继续沉到 `hw.yaml / req.yaml`，或先把文档解析进项目缓存
- `$emb-scan`、`$emb-plan`、`$emb-do`、`$emb-debug`、`$emb-review` 覆盖了日常嵌入式工作主流程
- `$emb-dispatch` 用于把“当前动作”或“下一步”直接转成轻量子 agent 分发合同，适合 Codex 这类上层 agent 自动消费
- `$emb-arch-review` 是显式触发的重型架构审查入口，适用于芯片选型、PoC 转量产前预审、RTOS / IoT 压力测试和失败预演；它默认复用 `review context` 与项目真值层，但不会把日常 `next / plan / review` 流程重新做重
- `$emb-pause` / `$emb-resume` 用于 clear context 前后的轻量衔接
- 对 `scan / plan / do / debug / review / note`，runtime 会输出 `agent_execution + dispatch_contract`，上层 agent 遇到 `recommended = true` 时应直接调用安装后的 `emb-*` 子 agent，而不是只打印建议
- 如果当前运行时不能直接按名字调用已安装的 `emb-*` agent，就改走 `dispatch_contract` 里的 `spawn_fallback`，用通用 `spawn_agent` 加载对应 agent 指令

## Advanced

- `$emb-note`
- `$emb-prefs`
- `$emb-template`
- `$emb-adapter`
- `$emb-tool`

这一层不是每天都要用：

- `$emb-note` 用于把长期有效的技术结论落到固定文档
- `$emb-prefs` 用于切换轻量偏好，例如真值优先级、`plan/review` 路由和验证强度
- `$emb-template` 用于生成固定文档骨架，或补 profile / pack 模板
- `$emb-adapter` 用于管理 path/git adapter source，并把外部厂商扩展同步到项目或 runtime
- `$emb-tool` 用于查看抽象工具规格，以及项目/运行时外部 adapter、family、device、chip 扩展入口

## Compatibility

- `$emb-attach`

这是兼容旧用法的别名，保留实现，但不再作为官方流程入口。

补充：

- 真正工作的 CLI 是 `~/.codex/emb-agent/bin/emb-agent.cjs` 或 `./.codex/emb-agent/bin/emb-agent.cjs`
- skill 只是轻量入口壳，真正的调度和输出结构由 runtime 生成
- `config show` 可查看当前 runtime 配置
- `template fill architecture-review --force` 可生成 `docs/ARCH-REVIEW.md` 审查骨架

## 外部扩展布局

运行时扩展目录：

```text
~/.codex/emb-agent/
├── adapters/
└── extensions/
    ├── tools/
    │   ├── registry.json
    │   ├── timer-calc.cjs
    │   ├── specs/
    │   ├── families/
    │   └── devices/
    └── chips/
        ├── registry.json
        └── devices/
```

项目级扩展目录：

```text
<repo>/emb-agent/
├── adapters/
└── extensions/
    ├── tools/
    │   ├── registry.json
    │   ├── timer-calc.cjs
    │   ├── specs/
    │   ├── families/
    │   └── devices/
    └── chips/
        ├── registry.json
        └── devices/
```

生成这些骨架可以直接用模板：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-extension-registry --field FAMILY_NAME=vendor-family --field DEVICE_NAME=vendor-device --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill chip-extension-registry --field CHIP_NAME=vendor-chip --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-adapter --field TOOL_NAME=timer-calc --field ADAPTER_NAME=vendor-timer-adapter --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-family --field SLUG=vendor-family --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-device --field SLUG=vendor-device --field DEVICE_NAME=vendor-device --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill chip-profile --field SLUG=vendor-chip --field CHIP_NAME=vendor-chip --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
```

## Runtime

也可以直接调用 runtime。下面这层主要服务高级用户、脚本和其他 agent 复用，不要求普通用户记住全部：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs init
node ~/.codex/emb-agent/bin/emb-agent.cjs init --mcu MCU_NAME --goal "stabilize wakeup path"
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest hardware --truth "PROGRAM_PIN reserved for flashing" --source docs/MCU-datasheet.md
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest requirements --constraint "boot within 100 ms" --source README.md
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU-datasheet.pdf --provider mineru --kind datasheet --to hardware
node ~/.codex/emb-agent/bin/emb-agent.cjs doc list
node ~/.codex/emb-agent/bin/emb-agent.cjs doc show <doc-id>
node ~/.codex/emb-agent/bin/emb-agent.cjs doc show <doc-id> --preset hw-safe
node ~/.codex/emb-agent/bin/emb-agent.cjs doc show <doc-id> --preset hw-safe --apply-ready
node ~/.codex/emb-agent/bin/emb-agent.cjs doc diff <doc-id> --to hardware --only constraints,sources
node ~/.codex/emb-agent/bin/emb-agent.cjs doc diff <doc-id> --to hardware --only constraints,sources --save-as hw-safe
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc <doc-id> --from-last-diff
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc <doc-id> --preset hw-safe
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc <doc-id> --to hardware
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc <doc-id> --to hardware --only constraints,sources
node ~/.codex/emb-agent/bin/emb-agent.cjs next
node ~/.codex/emb-agent/bin/emb-agent.cjs pause
node ~/.codex/emb-agent/bin/emb-agent.cjs pause show
node ~/.codex/emb-agent/bin/emb-agent.cjs scan
node ~/.codex/emb-agent/bin/emb-agent.cjs scan save hardware "Captured current entry and truth source order" --fact "main.c remains latest touched file"
node ~/.codex/emb-agent/bin/emb-agent.cjs plan
node ~/.codex/emb-agent/bin/emb-agent.cjs arch-review
node ~/.codex/emb-agent/bin/emb-agent.cjs plan save "Prepare minimal wakeup-timer fix plan" --risk "Wakeup path may re-trigger timer flag" --verify "Verify wakeup path on bench"
node ~/.codex/emb-agent/bin/emb-agent.cjs do
node ~/.codex/emb-agent/bin/emb-agent.cjs debug
node ~/.codex/emb-agent/bin/emb-agent.cjs review
node ~/.codex/emb-agent/bin/emb-agent.cjs review save "Reconnect path needs offline gate" --finding "Offline fallback is underspecified" --check "Verify reconnect after timeout"
node ~/.codex/emb-agent/bin/emb-agent.cjs note
node ~/.codex/emb-agent/bin/emb-agent.cjs note add hardware "PROGRAM_PIN is flashing path" --kind hardware_truth --evidence docs/MCU-datasheet.md
node ~/.codex/emb-agent/bin/emb-agent.cjs dispatch next
node ~/.codex/emb-agent/bin/emb-agent.cjs dispatch show plan
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs show
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set truth_source_mode code_first
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter status
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source add vendor-pack --type path --location /abs/path/to/vendor-pack
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source add vendor-pack --type git --location https://example.com/vendor-pack.git --branch main --subdir emb-agent
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync vendor-pack
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync --all
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source remove vendor-pack
node ~/.codex/emb-agent/bin/emb-agent.cjs tool list
node ~/.codex/emb-agent/bin/emb-agent.cjs tool show timer-calc
node ~/.codex/emb-agent/bin/emb-agent.cjs tool run timer-calc --family FAMILY_NAME --device DEVICE_NAME --timer TIMER_NAME --clock-source CLOCK_SOURCE --clock-hz 16000000 --prescaler 16 --interrupt-bit 10 --target-us 560
node ~/.codex/emb-agent/bin/emb-agent.cjs tool family show FAMILY_NAME
node ~/.codex/emb-agent/bin/emb-agent.cjs tool device show DEVICE_NAME
node ~/.codex/emb-agent/bin/emb-agent.cjs chip list
node ~/.codex/emb-agent/bin/emb-agent.cjs chip show CHIP_NAME
node ~/.codex/emb-agent/bin/emb-agent.cjs project show
node ~/.codex/emb-agent/bin/emb-agent.cjs project show --effective
node ~/.codex/emb-agent/bin/emb-agent.cjs project show --effective --field effective.arch_review_triggers
node ~/.codex/emb-agent/bin/emb-agent.cjs project set --field arch_review.trigger_patterns --value '["chip selection","方案预审"]'
node ~/.codex/emb-agent/bin/emb-agent.cjs schedule show review
```

若要让 MinerU 自动判断走 `agent` 还是 `api`，推荐在项目的 `emb-agent/project.json` 里保留 `mode: "auto"`，只改实际入口 URL：

```json
{
  "adapter_sources": [
    {
      "name": "vendor-pack",
      "type": "git",
      "location": "https://example.com/vendor-pack.git",
      "branch": "main",
      "subdir": "emb-agent",
      "enabled": true
    }
  ],
  "integrations": {
    "mineru": {
      "mode": "auto",
      "base_url": "",
      "api_key": "",
      "api_key_env": "MINERU_API_KEY",
      "model_version": "vlm",
      "language": "ch",
      "enable_table": true,
      "is_ocr": false,
      "enable_formula": true,
      "poll_interval_ms": 3000,
      "timeout_ms": 300000,
      "auto_api_page_threshold": 12,
      "auto_api_file_size_kb": 4096
    }
  }
}
```

`mode=auto` 时，provider 的判定顺序是：

1. 若 `base_url` 显式指向 `.../api/v*/agent` 或 `.../api/v*`，优先按它走
2. 否则按阈值判断：
   当前选择页数 `>= auto_api_page_threshold`，或文件大小 `>= auto_api_file_size_kb`
3. 命中大文档阈值且拿得到 `MINERU_API_KEY` 时走 api；否则回退 agent

建议保持 `base_url` 为空，让 emb-agent 自动用内建的：

- agent: `https://mineru.net/api/v1/agent`
- api: `https://mineru.net/api/v4`

建议把 token 放环境变量，而不是写死在项目配置里：

```bash
export MINERU_API_KEY=<your-token>
```

也可以直接在项目根目录或 Codex 根目录放 `.env`，`emb-agent` 会轻量读取其中的 `MINERU_API_KEY`。

如果你希望 `$emb-next` 在特定语义下自动切到 `$emb-arch-review`，可以在项目的 `emb-agent/project.json` 里加：

```json
{
  "arch_review": {
    "trigger_patterns": [
      "chip selection",
      "方案预审",
      "驱动策略评审",
      "PoC转量产"
    ]
  }
}
```

规则优先级：

1. `emb-agent/project.json` 的 `arch_review.trigger_patterns`
2. 当前 `profile` 的 `arch_review_triggers`
3. runtime 内置默认触发词

用 `node ~/.codex/emb-agent/bin/emb-agent.cjs status` 可以直接看到当前生效的 `arch_review_triggers`。
如果想把项目默认配置和当前生效结果一次展开，用 `node ~/.codex/emb-agent/bin/emb-agent.cjs project show --effective`。
如果只想给脚本或别的 agent 取单个字段，用 `node ~/.codex/emb-agent/bin/emb-agent.cjs project show --effective --field effective.arch_review_triggers`。
如果想直接写项目配置而不是手改 JSON，用 `node ~/.codex/emb-agent/bin/emb-agent.cjs project set --field arch_review.trigger_patterns --value '["chip selection","方案预审"]'`。

## 当前能力

- runtime config 已独立到 `emb-agent/config.json`
- `profile`、`pack`、`template config`、`session` 已接统一校验
- session 已带 `session_version`
- stale lock 会自动清理
- 已支持轻量 `pause/resume` handoff，不引入 `.planning/`
- 已支持轻量 `next` 自动路由，用于嵌入式任务的下一步判断
- 新增轻量 scheduler，统一驱动 `scan/plan/do/debug/review/note`
- 新增最小嵌入式偏好层，可控制真值优先级、`plan/review` 路由和验证强度
- 新增项目级默认配置 `emb-agent/project.json`，可稳定指定默认 `profile/pack/preferences`
- `arch-review` 触发词现在支持 profile 默认值和项目级覆盖，不必继续硬编码在 CLI
- 新增项目内轻量真值层 `emb-agent/hw.yaml` 与 `emb-agent/req.yaml`，用于沉淀硬件与需求事实
- `init` 现在已收敛成唯一官方初始化入口，可直接把已有工程接入 emb-agent，并自动探测 datasheet / schematic / code / project files
- 新增 `ingest hardware / ingest requirements`，用于持续更新项目内真值层
- 新增 `ingest doc`，可通过 `mineru` provider 把本地手册解析到项目缓存
- `init-project` 现在会按项目画像落固定文档骨架，例如 `docs/HARDWARE-LOGIC.md`、`docs/DEBUG-NOTES.md`
- `init-project` 现在会预建 `emb-agent/cache/docs/`，供文档解析结果缓存
- `scan/plan` 现在会优先读取项目内 `hw.yaml / req.yaml`，减少反复重读整本手册
- `scan save` 现在可把扫描结果直接追加到目标文档的 `Emb-Agent Scans` 区块
- `plan save` 现在可把 `micro-plan` 直接追加到目标文档的 `Emb-Agent Plans` 区块
- `note add` 现在可把长期有效结论直接追加到目标文档的 `Emb-Agent Notes` 区块
- `review save` 现在可把结构性 review 结果直接追加到 `docs/REVIEW-REPORT.md`
- `scan save hardware` 与 `note add hardware --kind hardware_truth` 会自动同步到 `emb-agent/hw.yaml`
- `plan save` 会自动把目标和验证条件同步到 `emb-agent/req.yaml`
- `ingest doc` 会把解析结果缓存到 `emb-agent/cache/docs/<doc-id>/`，并维护 `index.json`
- `doc list` 可列出当前项目缓存过的文档及其 `doc-id`，并带上极简 `last_diff_hit/last_diff_to` 与 `preset_count/preset_names/preset_names_more` 摘要；列表里的 preset 名会做轻量截断，完整列表看 `doc show`
- `doc show <doc-id>` 可查看单个缓存文档的来源、解析信息、产物状态、最近一次 `doc diff` 摘要，以及当前可用 preset 列表
- `doc show <doc-id> --preset <name>` 可直接预览该 preset 应用于当前文档时会改哪些字段
- `doc show <doc-id> --preset <name> --apply-ready` 会额外给出可直接执行的 apply 命令提示
- `doc diff <doc-id> --to ...` 可按真实 apply 语义预览哪些字段会 `set/append/skip`
- `doc diff` 会把最近一次预览选择轻量记到 `emb-agent/cache/docs/index.json.session.last_diff`
- `doc diff ... --save-as <name>` 可把当前字段选择存成命名 preset，仍然落在同一个 `index.json`
- `ingest doc --to hardware|requirements` 会额外生成基于规则的 `facts.*.yaml` 草稿，先给出最小可复用事实
- `ingest apply doc <doc-id> --to hardware|requirements` 可把文档草稿里的稳定字段写回 `hw.yaml / req.yaml`
- `ingest apply doc ... --only ...` 可只应用部分稳定字段，例如只吸收 `constraints,sources`
- `ingest apply doc <doc-id> --from-last-diff` 可直接回放最近一次 `doc diff` 的 `to/only/force` 选择，少输一遍参数
- `ingest apply doc <doc-id> --preset <name>` 可回放命名 preset，适合反复使用同一组应用字段
- `ingest apply doc` 默认是幂等的：同一 `doc-id + to + source_hash` 重复应用会直接返回 `already_applied`
- `scan save / plan save / review save / note add` 在同一区块遇到相同 `Summary` 时会更新旧条目，避免文档重复膨胀
- 当前 `mineru` 集成同时支持轻量 `agent` 链路和精准 `api` 链路：默认配置是 `mode=auto + 空 base_url`，所以小文档默认仍走 agent；当页数或文件大小超过阈值且存在 `api_key` 或 `MINERU_API_KEY` 时，会自动切到官方 batch API + zip 结果提取；若显式设置 `base_url`，则该路由优先
- `doc show <doc-id> --preset <name> --apply-ready` 现在除命令字符串外，还会返回结构化 `argv`，便于其他 agent/runtime 直接转发执行
- 安装后的 CLI 现在按执行时 `cwd` 解析项目级 `emb-agent/profiles/` 和 `emb-agent/packs/`，不会把首次加载目录错误固化
- core 已收敛成 abstract-only：内置 `tools/specs/` 和空 registry，但不内置任何厂商 family/device/chip profile，也不内置 calculator 实现
- 运行时与项目侧都预建 `adapters/`、`extensions/tools/*`、`extensions/chips/*`，用于挂接外部公式、寄存器边界和芯片资料索引
- adapter source 已正式进入 `project.json`，支持 `path/git` 两种来源，并带同步清单
- `tool run` 只有在检测到外部 adapter 时才执行；否则稳定返回 `adapter-required`
- 原生命令会直接输出结构化 JSON，便于 skill、CLI 或其他 AI runtime 复用
- 仓库内已有最小测试：runtime 校验 + init-project + scheduler 路由 + scan/plan/note/review 持久化 + 安装集成链路

## 项目侧约定

默认不在项目里铺整套 runtime。

如果需要项目自定义，只使用轻量目录：

```text
<repo>/
├── docs/
│   ├── HARDWARE-LOGIC.md
│   ├── DEBUG-NOTES.md
│   ├── REVIEW-REPORT.md
│   ├── CONNECTIVITY.md
│   └── RELEASE-NOTES.md
└── emb-agent/
    ├── project.json
    ├── hw.yaml
    ├── req.yaml
    ├── cache/
    │   ├── docs/
    │   └── adapter-sources/
    ├── adapters/
    ├── extensions/
    │   ├── tools/
    │   │   ├── specs/
    │   │   ├── families/
    │   │   └── devices/
    │   └── chips/
    │       └── devices/
    ├── profiles/
    └── packs/
```

说明：

- `emb-agent/project.json` 是项目级默认配置，定义默认 `profile`、`pack`、`preferences` 和轻量 integration 配置
- `emb-agent/project.json` 也可定义 `adapter_sources`，声明外部 adapter 仓库或本地目录
- `emb-agent/project.json` 也可定义 `arch_review.trigger_patterns`，用于覆盖当前项目哪些语义会让 `next` 建议 `$emb-arch-review`
- `emb-agent/hw.yaml` 是项目级硬件真值层，记录 MCU、引脚、外设、约束和 unknowns
- `emb-agent/req.yaml` 是项目级需求真值层，记录目标、约束、验收和 unknowns
- `emb-agent/cache/docs/` 是项目级文档解析缓存，保存 Markdown、结构化结果和基于规则的事实草稿
- `emb-agent/cache/adapter-sources/` 是 git adapter source 的本地缓存目录
- `docs/` 是 `init-project` 按项目画像生成的模板结果
- `emb-agent/adapters/` 与 `emb-agent/extensions/` 是项目级外部工具/芯片扩展入口
- `emb-agent/profiles/` 和 `emb-agent/packs/` 是项目自定义扩展
- clear context 后的恢复状态保存在安装目录 `emb-agent/state/projects/`，按项目路径索引

## 卸载

```bash
npx emb-agent --global --uninstall
```

或：

```bash
npx emb-agent --local --uninstall
```

卸载会移除：

- `skills/emb-*`
- `agents/emb-*.toml`
- `emb-agent/`
- `config.toml` 里的 emb-agent managed block
