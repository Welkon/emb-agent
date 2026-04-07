---
name: emb-tool
description: Inspect the lightweight emb-agent tool subsystem for abstract calculator specs and optional external adapters.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-tool

你负责使用 emb-agent 的工具子系统骨架。

这层不是 GUI 工具集合，而是：

- 通用计算核心
- 抽象工具规格
- 可选外部 adapter / profile 接口

## 常用命令

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs tool list
node ~/.codex/emb-agent/bin/emb-agent.cjs tool show timer-calc
node ~/.codex/emb-agent/bin/emb-agent.cjs tool run timer-calc --family FAMILY_NAME --device DEVICE_NAME --timer TIMER_NAME --clock-source CLOCK_SOURCE --clock-hz 16000000 --prescaler 16 --interrupt-bit 10 --target-us 560
node ~/.codex/emb-agent/bin/emb-agent.cjs tool family list
node ~/.codex/emb-agent/bin/emb-agent.cjs tool family show FAMILY_NAME
node ~/.codex/emb-agent/bin/emb-agent.cjs tool device list
node ~/.codex/emb-agent/bin/emb-agent.cjs tool device show DEVICE_NAME
node ~/.codex/emb-agent/bin/emb-agent.cjs chip list
node ~/.codex/emb-agent/bin/emb-agent.cjs chip show CHIP_NAME
```

## 使用原则

- 先看工具规格，再决定是否实现计算器
- emb core 不内置厂商实现
- 如需具体 MCU 公式，请在 core 外提供 adapter
- 不直接复制厂商 GUI 逻辑，优先 clean-room 重写
- `tool run` 没找到 adapter 时会返回 `adapter-required`
- `chip` 目录层只是可选扩展入口；core 默认不带任何 chip profile

## 扩展目录

- 运行时：`~/.codex/emb-agent/adapters/`、`~/.codex/emb-agent/extensions/tools/`、`~/.codex/emb-agent/extensions/chips/`
- 项目侧：`./.emb-agent/adapters/`、`./.emb-agent/extensions/tools/`、`./.emb-agent/extensions/chips/`

## 建议生成方式

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --family vendor-family --device vendor-device --chip vendor-chip --tool timer-calc --package sop8 --pin-count 8
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --from-project
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --from-doc <doc-id> --vendor Padauk
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter generate --from-project --output-root /abs/path/to/emb-agent-adapters
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-extension-registry --field FAMILY_NAME=vendor-family --field DEVICE_NAME=vendor-device --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-adapter --field TOOL_NAME=timer-calc --field ADAPTER_NAME=vendor-timer-adapter --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-family --field SLUG=vendor-family --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-device --field SLUG=vendor-device --field DEVICE_NAME=vendor-device --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill chip-extension-registry --field CHIP_NAME=vendor-chip --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill chip-profile --field SLUG=vendor-chip --field CHIP_NAME=vendor-chip --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
```

- 优先用 `adapter derive` 起草 profile
- 要往 `emb-agent-adapters` 这类共享仓库直接产出时，用 `adapter generate --output-root <path>`
- 已有 `hw.yaml` 或已 ingest 文档时，优先用 `--from-project` / `--from-doc`，不要重复手填 slug
- `adapter derive` 现在会同步起草 `device bindings` 的 draft 骨架，但真实公式和寄存器边界仍要你或 agent 按手册补完
- `adapter derive` 还会生成对应 tool 的 draft route；在 route 去掉 `draft` 标记并补真实实现前，调度只会把它视为 `draft-adapter`
- `timer-calc` 的 draft route 已支持首版通用搜索；当 binding 里有 `prescalers` 和 `interrupt_bits/counter_bits` 时，可以直接执行并拿到候选组合
- `pwm-calc` 的 draft route 也已支持首版通用搜索；当 binding 里有 `default_output_pin`、`prescalers` 和 `counter_bits/period_bits` 时，可以直接执行并拿到 PWM 候选组合
- `adc-scale` 的 draft route 也已支持首版通用换算；当 binding 里有 `default_channel`，并提供 `reference-v` 或固定参考源与 `resolution` 时，可以直接执行并拿到换算结果
- `comparator-threshold` 的 draft route 也已支持首版可行性检查；当 binding 里有正负输入源范围，且提供 `vdd` 与目标阈值时，可以直接执行并拿到推荐参考侧与边界告警
- 只有要精细定制模板内容时，再回退到 `template fill`
