---
name: emb-tool
description: Inspect the lightweight emb-agent tool subsystem for abstract calculator specs and optional external adapters.
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
- 项目侧：`./emb-agent/adapters/`、`./emb-agent/extensions/tools/`、`./emb-agent/extensions/chips/`

## 建议生成方式

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-extension-registry --field FAMILY_NAME=vendor-family --field DEVICE_NAME=vendor-device --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-adapter --field TOOL_NAME=timer-calc --field ADAPTER_NAME=vendor-timer-adapter --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-family --field SLUG=vendor-family --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill tool-device --field SLUG=vendor-device --field DEVICE_NAME=vendor-device --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill chip-extension-registry --field CHIP_NAME=vendor-chip --force
node ~/.codex/emb-agent/bin/emb-agent.cjs template fill chip-profile --field SLUG=vendor-chip --field CHIP_NAME=vendor-chip --field FAMILY_NAME=vendor-family --field TOOL_NAME=timer-calc --force
```
