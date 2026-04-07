---
name: emb-help
description: Show the installed emb-agent command set and when to use each command.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-help

Output the emb-agent command reference below and nothing else.

## Quick Flow

- 运行时路径约定：
  `Codex -> ~/.codex/emb-agent/bin/emb-agent.cjs`
  `Claude Code -> ~/.claude/emb-agent/bin/emb-agent.cjs`
  `runtime-home -> Codex: ~/.codex, Claude Code: ~/.claude`
  下文统一写作 `<runtime-cli> = node <runtime-home>/emb-agent/bin/emb-agent.cjs`

- 第一次进入项目：
  `<runtime-cli> init`
  `<runtime-cli> next`
- 后续继续当前项目：
  `<runtime-cli> next`
- 如果是定时器 / PWM / ADC / 比较器 / 引脚 / 寄存器 / 手册定位问题：
  先看 `next.tool_recommendation`
  再看 `dispatch next` / `orchestrate` 里的 `tool_execution`
  若 `tool_execution.status = ready`，优先执行对应 `tool run ...`
- 需要导入手册/PDF：
  `<runtime-cli> ingest doc --file <path> --provider mineru --kind datasheet --to hardware`

## Basic

- `$emb-help`
  用于查看当前安装的 emb-agent 官方命令入口、推荐使用顺序和 runtime 参考命令。
- `$emb-init-project`
  唯一官方初始化入口。用于初始化当前项目的 emb-agent 轻量上下文、项目默认配置、真值层和固定文档骨架，不创建项目私有 runtime。
- `$emb-next`
  默认入口。根据当前 session 和 handoff 自动给出最合理的下一步。
- `$emb-health`
  用于检查当前项目的真值层、session、adapter、文档缓存与芯片画像是否一致，先判断当前上下文是否可信。
- `$emb-update`
  用于查看当前 runtime 的安装版本、hook/runtime 是否漂移，以及最近一次版本检查结果。
- `$emb-ingest`
  用于把新确认的硬件或需求事实写回 `hw.yaml / req.yaml`，或先把外部文档解析进项目缓存。
- `$emb-scan`
  用于定位代码入口、硬件真值、协议实现和关键文件，并支持直接保存扫描快照。
- `$emb-plan`
  用于在复杂嵌入式任务前生成一份轻量 `micro-plan`，并支持直接保存计划记录。
- `$emb-do`
  用于直接执行轻量代码或文档修改。
- `$emb-debug`
  用于处理“现象已知、根因不明”的问题。
- `$emb-review`
  用于复杂系统的结构性检查，例如 RTOS、IoT、升级链路，并支持直接保存 review 报告。
- `$emb-dispatch`
  用于把当前动作或下一步直接转成轻量子 agent 分发合同；若 scan 已命中可执行工具，也会直接给出 `tool_execution`。
- `$emb-orchestrate`
  用于把 `next + dispatch + context hygiene` 合成一个统一轻量 orchestrator 合同，告诉上层 agent 当前该 inline、该起谁、何时该 pause/resume；若 scan 已命中可执行工具，会切到 `inline-tool-first`。
- `$emb-arch-review`
  用于显式触发一次更重的系统级架构审查，覆盖选型、架构压力测试、量产前预审和失败预演，但不把默认流程做重。
- `$emb-pause`
  用于创建轻量 handoff，让 clear context 后的恢复更稳定。
- `$emb-resume`
  clear 上下文后恢复当前项目的嵌入式工作上下文。
- `$emb-thread`
  用于管理长期存在的轻量技术线程，例如某个外设坑点、板级疑点或跨会话跟踪问题，但不升级成厚 planning。
- `$emb-forensics`
  用于在流程卡住、上下文漂移、handoff 堆积或真值层异常时做一次轻量取证，输出证据化诊断报告。

对 `scan / plan / do / debug / review / note`，runtime 输出现在都会带 `agent_execution`，用于告诉上层 agent:

- 当前动作应 inline 还是调用安装后的 `emb-*` 子 agent
- 推荐主 agent 和 supporting agents 是谁
- 哪些场景适合 fan-out，哪些场景不值得展开

同时还会带 `dispatch_contract`，用于告诉上层 agent:

- 推荐时是否应该直接自动发起子 agent
- 哪个 agent 应该先启动，哪些 supporting agent 可以并行
- 每个子 agent 应拿到哪些上下文、该产出什么、由谁整合
- 如果运行时只支持通用 `spawn_agent`，该走哪个 `spawn_fallback`

对 `next / dispatch next / orchestrate`，如果已经识别到可直接运行的硬件工具，还会额外带：

- `tool_recommendation`
  - 当前首选工具
  - `cli_draft`
  - `missing_inputs`
- `tool_execution`
  - 当前是否应先跑 tool
  - tool 是否已经 `ready`
  - 在 orchestrator 里是否切到 `inline-tool-first`

## Advanced

- `$emb-note`
  用于把长期有效的技术结论写入固定文档，并支持直接追加到目标文档。
- `$emb-prefs`
  用于查看或设置轻量偏好，例如真值优先级、`plan/review` 路由和验证强度。
- `$emb-settings`
  用统一入口管理 profile、packs 和轻量偏好，适合日常切换，不必分别记 `profile / pack / prefs`。
- `$emb-manager`
  用单终端轻量总控视图汇总当前 `next`、handoff、threads、settings 和最新报告，方便快速决定下一步。
- `$emb-template`
  用于生成固定文档骨架或 profile / pack 模板。
- `$emb-adapter`
  用于管理外部 adapter source，并把 path/git 扩展同步到项目或 runtime。
- `$emb-tool`
  用于查看工具子系统骨架，包括抽象 calculator spec 与可选扩展接口。
- `$emb-session-report`
  用于把当前工作状态压成轻量 session report，方便审计和下次快速恢复。

## Runtime Layout

安装器会在运行时目录下铺这些内容：

- `skills/emb-*`
- `agents/emb-*`
- `emb-agent/`
- 宿主配置文件中的 emb-agent hook / agent 注册

当前正式支持：

- `Codex`
  - agents 为 `agents/emb-*.toml`
  - hooks 进入 `config.toml`
  - runtime home 通常为 `~/.codex`
- `Claude Code`
  - agents 为 `agents/emb-*.md`
  - hooks 进入 `settings.json`
  - runtime home 通常为 `~/.claude`

真正工作的 runtime 在：

- `<runtime-home>/emb-agent/`
- `./.codex/emb-agent/` 或 `./.claude/emb-agent/`（本地安装）

## Runtime

下面这些是 runtime 原生命令，主要服务高级用户、脚本和其他 agent 复用。统一前缀均为：

- `<runtime-cli>`

项目进入与主流程：

- `<runtime-cli> init`
- `<runtime-cli> init --mcu <name> --board <name> --goal <text>`
- `<runtime-cli> next`
- `<runtime-cli> health`
- `<runtime-cli> update`
- `<runtime-cli> update check`
- `<runtime-cli> scan`
- `<runtime-cli> scan save <target> <summary> --fact <text>`
- `<runtime-cli> plan`
- `<runtime-cli> plan save <summary> --risk <text> --step <text> --verify <text>`
- `<runtime-cli> do`
- `<runtime-cli> debug`
- `<runtime-cli> review`
- `<runtime-cli> review save <summary> --finding <text> --check <text>`
- `<runtime-cli> arch-review`
- `<runtime-cli> orchestrate`
- `<runtime-cli> orchestrate show <action>`
- `<runtime-cli> dispatch next`
- `<runtime-cli> dispatch show <action>`
- `<runtime-cli> schedule show <action>`

真值、文档与笔记：

- `<runtime-cli> ingest hardware --truth <text> --source <path>`
- `<runtime-cli> ingest requirements --goal <text> --source <path>`
- `<runtime-cli> ingest doc --file <path> --provider mineru --kind datasheet`
- `<runtime-cli> ingest apply doc <doc-id> --to hardware`
- `<runtime-cli> ingest apply doc <doc-id> --to hardware --only constraints,sources`
- `<runtime-cli> ingest apply doc <doc-id> --from-last-diff`
- `<runtime-cli> ingest apply doc <doc-id> --preset hw-safe`
- `<runtime-cli> doc list`
- `<runtime-cli> doc show <doc-id>`
- `<runtime-cli> doc show <doc-id> --preset hw-safe`
- `<runtime-cli> doc show <doc-id> --preset hw-safe --apply-ready`
- `<runtime-cli> doc diff <doc-id> --to hardware --only constraints,sources`
- `<runtime-cli> doc diff <doc-id> --to hardware --only constraints,sources --save-as hw-safe`
- `<runtime-cli> note`
- `<runtime-cli> note add <target> <summary> --kind <kind> --evidence <text>`

上下文、线程与取证：

- `<runtime-cli> pause`
- `<runtime-cli> pause show`
- `<runtime-cli> pause clear`
- `<runtime-cli> thread list`
- `<runtime-cli> thread add <summary>`
- `<runtime-cli> thread show <name>`
- `<runtime-cli> thread resume <name>`
- `<runtime-cli> thread resolve <name> [note]`
- `<runtime-cli> forensics`
- `<runtime-cli> forensics why planner keeps drifting after resume`
- `<runtime-cli> session-report`
- `<runtime-cli> session-report capture current bring-up handoff`
- `<runtime-cli> manager`

设置、画像与项目状态：

- `<runtime-cli> settings show`
- `<runtime-cli> settings set profile rtos-iot`
- `<runtime-cli> settings set packs sensor-node,connected-appliance`
- `<runtime-cli> settings set plan_mode always`
- `<runtime-cli> settings reset`
- `<runtime-cli> prefs show`
- `<runtime-cli> prefs set <key> <value>`
- `<runtime-cli> project show`
- `<runtime-cli> project show --effective`
- `<runtime-cli> project show --effective --field effective.arch_review_triggers`
- `<runtime-cli> project set --field arch_review.trigger_patterns --value '["chip selection","方案预审"]'`

模板、adapter、tool、chip：

- `<runtime-cli> template fill architecture-review --force`
- `<runtime-cli> template fill tool-extension-registry --field FAMILY_NAME=vendor-family --field DEVICE_NAME=vendor-device --force`
- `<runtime-cli> template fill chip-extension-registry --field CHIP_NAME=vendor-chip --force`
- `<runtime-cli> template fill tool-adapter --field TOOL_NAME=timer-calc --field ADAPTER_NAME=vendor-timer-adapter --force`
- `<runtime-cli> template fill tool-family --field SLUG=vendor-family --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force`
- `<runtime-cli> template fill tool-device --field SLUG=vendor-device --field DEVICE_NAME=vendor-device --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force`
- `<runtime-cli> template fill chip-profile --field SLUG=vendor-chip --field CHIP_NAME=vendor-chip --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force`
- `<runtime-cli> adapter status`
- `<runtime-cli> adapter source list`
- `<runtime-cli> adapter bootstrap`
- `<runtime-cli> adapter bootstrap <name> [--type path|git --location <path-or-url>]`
- `<runtime-cli> adapter source add <name> --type path --location /abs/path/to/source`
- `<runtime-cli> adapter source add <name> --type git --location <git-url-or-local-repo> [--branch main] [--subdir emb-agent]`
- `<runtime-cli> adapter sync <name> [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>]`
- `<runtime-cli> adapter sync --all [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>]`
- `<runtime-cli> adapter derive --family vendor-family --device vendor-device --chip vendor-chip --tool timer-calc --package sop8 --pin-count 8`
- `<runtime-cli> adapter derive --from-project`
- `<runtime-cli> adapter derive --from-doc <doc-id> --vendor Padauk`
- `<runtime-cli> adapter generate --from-project --output-root /abs/path/to/emb-agent-adapters`
- `<runtime-cli> adapter source remove <name>`
- `<runtime-cli> tool list`
- `<runtime-cli> tool show timer-calc`
- `<runtime-cli> tool run timer-calc --family FAMILY_NAME --device DEVICE_NAME --timer TIMER_NAME --clock-source CLOCK_SOURCE --clock-hz 16000000 --prescaler 16 --interrupt-bit 10 --target-us 560`
- `<runtime-cli> tool run pwm-calc --family FAMILY_NAME --device DEVICE_NAME --output-pin PA3 --clock-source SYSCLK --clock-hz 16000000 --target-hz 3906.25 --target-duty 50`
- `<runtime-cli> tool run adc-scale --family FAMILY_NAME --device DEVICE_NAME --channel PA0 --reference-source vdd --resolution 10 --sample-code 512`
- `<runtime-cli> tool run comparator-threshold --family FAMILY_NAME --device DEVICE_NAME --positive-source PA0 --negative-source vref_ladder --vdd 5 --target-threshold-v 2.5`
- `<runtime-cli> tool family list`
- `<runtime-cli> tool family show FAMILY_NAME`
- `<runtime-cli> tool device list`
- `<runtime-cli> tool device show DEVICE_NAME`
- `<runtime-cli> chip list`
- `<runtime-cli> chip show CHIP_NAME`

项目内若需要自定义，只使用轻量扩展目录：

- `./emb-agent/project.json`
- `./emb-agent/cache/docs/`
- `./emb-agent/threads/`
- `./emb-agent/reports/forensics/`
- `./emb-agent/reports/sessions/`
- `./emb-agent/adapters/`
- `./emb-agent/extensions/tools/`
- `./emb-agent/extensions/chips/`
- `./emb-agent/profiles/`
- `./emb-agent/packs/`

说明：

- `emb-agent` 是通用嵌入式 agent，不绑定任何厂商、MCU 家族或固定 datasheet
- `tool run` 若没有外部 adapter，会返回 `adapter-required`
- `adapter bootstrap` 是首次接入的最短路径；会先确保 source 存在，再按当前项目匹配同步
- `adapter source add` 只登记 source；`adapter sync` 才会真正同步文件
- `adapter sync` 默认优先按 `hw.yaml` 自动匹配当前芯片，只同步命中的 adapter/profile 子集；匹配不到时再回退全量同步
- adapter source 支持本地 path 仓库，也支持 git 仓库
- source 根目录既可以直接包含 `adapters/` 和 `extensions/`，也可以再包一层 `emb-agent/`
- `tool family/device` 与 `chip` 命令只展示外部安装或项目自带的 profile；core 默认为空
- `init` 不再预建空的 `extensions/tools/*`、`extensions/chips/*`；这些目录会在 `adapter sync`、`adapter derive`、`template fill` 或首次写 registry 时按需创建
- 已存在的 `docs/*.md` 默认不覆盖；只有显式 `--force` 才重写模板输出

`project.json` 除了 `profile`、`pack`、`preferences`、`integrations`，也可以加：

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
  "arch_review": {
    "trigger_patterns": [
      "chip selection",
      "方案预审",
      "PoC转量产"
    ]
  }
}
```

这样 `$emb-next` 遇到这些语义时，会优先建议 `$emb-arch-review`。

项目根目录和当前 runtime 根目录里的 `.env` 都会被轻量读取。
MinerU 默认是 `mode=auto + 空 base_url`。小文档默认走 agent；当页数或文件大小超过阈值且能拿到 `MINERU_API_KEY` 时会自动走官方 API。若显式把 `base_url` 设成 `https://mineru.net/api/v4` 或 `https://mineru.net/api/v1/agent`，则以该路由为准。
