---
name: emb-help
description: Show the installed emb-agent command set and when to use each command.
---

# emb-help

Output the emb-agent command reference below and nothing else.

## Quick Flow

- 第一次进入项目：
  `node ~/.codex/emb-agent/bin/emb-agent.cjs init`
  `node ~/.codex/emb-agent/bin/emb-agent.cjs next`
- 后续继续当前项目：
  `node ~/.codex/emb-agent/bin/emb-agent.cjs next`
- 需要导入手册/PDF：
  `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file <path> --provider mineru --kind datasheet --to hardware`

## Basic

- `$emb-init-project`
  唯一官方初始化入口。用于初始化当前项目的 emb-agent 轻量上下文、项目默认配置、真值层和固定文档骨架，不创建项目私有 runtime。
- `$emb-next`
  默认入口。根据当前 session 和 handoff 自动给出最合理的下一步。
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
  用于把当前动作或下一步直接转成轻量子 agent 分发合同，方便上层 agent 自动执行。
- `$emb-arch-review`
  用于显式触发一次更重的系统级架构审查，覆盖选型、架构压力测试、量产前预审和失败预演，但不把默认流程做重。
- `$emb-pause`
  用于创建轻量 handoff，让 clear context 后的恢复更稳定。
- `$emb-resume`
  clear 上下文后恢复当前项目的嵌入式工作上下文。

对 `scan / plan / do / debug / review / note`，runtime 输出现在都会带 `agent_execution`，用于告诉上层 agent:

- 当前动作应 inline 还是调用安装后的 `emb-*` 子 agent
- 推荐主 agent 和 supporting agents 是谁
- 哪些场景适合 fan-out，哪些场景不值得展开

同时还会带 `dispatch_contract`，用于告诉上层 agent:

- 推荐时是否应该直接自动发起子 agent
- 哪个 agent 应该先启动，哪些 supporting agent 可以并行
- 每个子 agent 应拿到哪些上下文、该产出什么、由谁整合
- 如果运行时只支持通用 `spawn_agent`，该走哪个 `spawn_fallback`

## Advanced

- `$emb-note`
  用于把长期有效的技术结论写入固定文档，并支持直接追加到目标文档。
- `$emb-prefs`
  用于查看或设置轻量偏好，例如真值优先级、`plan/review` 路由和验证强度。
- `$emb-template`
  用于生成固定文档骨架或 profile / pack 模板。
- `$emb-adapter`
  用于管理外部 adapter source，并把 path/git 扩展同步到项目或 runtime。
- `$emb-tool`
  用于查看工具子系统骨架，包括抽象 calculator spec 与可选扩展接口。

## Compatibility

- `$emb-attach`
  兼容旧用法的别名。保留实现，但不再作为官方流程入口。

## Runtime Layout

安装器会在 Codex 目录下铺这些内容：

- `skills/emb-*`
- `agents/emb-*.toml`
- `emb-agent/`
- `config.toml` 中的 emb-agent managed block

真正工作的 runtime 在：

- `~/.codex/emb-agent/` 或 `./.codex/emb-agent/`

## Runtime

下面这些是 runtime 原生命令，主要服务高级用户、脚本和其他 agent 复用，不要求普通用户记住全部：

- `node ~/.codex/emb-agent/bin/emb-agent.cjs next`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs init`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs init --mcu <name> --board <name> --goal <text>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest hardware --truth <text> --source <path>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest requirements --goal <text> --source <path>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file <path> --provider mineru --kind datasheet`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc <doc-id> --to hardware`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc <doc-id> --to hardware --only constraints,sources`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc <doc-id> --from-last-diff`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc <doc-id> --preset hw-safe`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs doc list`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs doc show <doc-id>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs doc show <doc-id> --preset hw-safe`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs doc show <doc-id> --preset hw-safe --apply-ready`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs doc diff <doc-id> --to hardware --only constraints,sources`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs doc diff <doc-id> --to hardware --only constraints,sources --save-as hw-safe`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs pause`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs pause show`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs pause clear`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs scan`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs scan save <target> <summary> --fact <text>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs plan`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs arch-review`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs template fill architecture-review --force`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-extension-registry --field FAMILY_NAME=vendor-family --field DEVICE_NAME=vendor-device --force`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs template fill chip-extension-registry --field CHIP_NAME=vendor-chip --force`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-adapter --field TOOL_NAME=timer-calc --field ADAPTER_NAME=vendor-timer-adapter --force`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-family --field SLUG=vendor-family --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-device --field SLUG=vendor-device --field DEVICE_NAME=vendor-device --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs template fill chip-profile --field SLUG=vendor-chip --field CHIP_NAME=vendor-chip --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs plan save <summary> --risk <text> --step <text> --verify <text>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs do`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs debug`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs review`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs review save <summary> --finding <text> --check <text>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs note`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs note add <target> <summary> --kind <kind> --evidence <text>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs dispatch next`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs dispatch show <action>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs prefs show`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set <key> <value>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs adapter status`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source list`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source add <name> --type path --location /abs/path/to/source`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source add <name> --type git --location <git-url-or-local-repo> [--branch main] [--subdir emb-agent]`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync <name>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync --all`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source remove <name>`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs tool list`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs tool show timer-calc`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs tool run timer-calc --family FAMILY_NAME --device DEVICE_NAME --timer TIMER_NAME --clock-source CLOCK_SOURCE --clock-hz 16000000 --prescaler 16 --interrupt-bit 10 --target-us 560`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs tool family list`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs tool family show FAMILY_NAME`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs tool device list`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs tool device show DEVICE_NAME`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs chip list`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs chip show CHIP_NAME`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs project show`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs project show --effective`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs project show --effective --field effective.arch_review_triggers`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs project set --field arch_review.trigger_patterns --value '["chip selection","方案预审"]'`
- `node ~/.codex/emb-agent/bin/emb-agent.cjs schedule show <action>`

项目内若需要自定义，只使用轻量扩展目录：

- `./emb-agent/project.json`
- `./emb-agent/cache/docs/`
- `./emb-agent/adapters/`
- `./emb-agent/extensions/tools/`
- `./emb-agent/extensions/chips/`
- `./emb-agent/profiles/`
- `./emb-agent/packs/`

说明：

- `emb-agent` 是通用嵌入式 agent，不绑定任何厂商、MCU 家族或固定 datasheet
- `tool run` 若没有外部 adapter，会返回 `adapter-required`
- `adapter source add` 只登记 source；`adapter sync` 才会真正同步文件
- adapter source 支持本地 path 仓库，也支持 git 仓库
- source 根目录既可以直接包含 `adapters/` 和 `extensions/`，也可以再包一层 `emb-agent/`
- `tool family/device` 与 `chip` 命令只展示外部安装或项目自带的 profile；core 默认为空
- `init` 会预建 `docs/`、`emb-agent/cache/docs/`、`emb-agent/cache/adapter-sources/`、`emb-agent/adapters/`、`emb-agent/extensions/tools/*`、`emb-agent/extensions/chips/*`
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

MinerU 默认是 `mode=auto + 空 base_url`。小文档默认走 agent；当页数或文件大小超过阈值且能拿到 `MINERU_API_KEY` 时会自动走官方 API。若显式把 `base_url` 设成 `https://mineru.net/api/v4` 或 `https://mineru.net/api/v1/agent`，则以该路由为准。项目根目录和 Codex 根目录里的 `.env` 都会被轻量读取。
