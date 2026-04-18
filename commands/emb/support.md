---
name: emb-support
description: Manage chip support sources, discovery, derivation, and reuse status.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-support

## Purpose

- Manage chip support sources, discovery, derivation, and reuse status.
- Prefer surfacing whether support is `reusable`, `reusable-candidate`, or `project-only` before reading trust details.

## Usage

- Run `$emb-support` when the issue is chip-support maintenance rather than normal project bootstrap.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- Most of this surface is advanced maintenance. The exception is `support bootstrap`, which is part of the known-chip fast path when you want direct control instead of `bootstrap run`.
- 当你准备让 agent / AI 解析 datasheet 并沉淀为结构化草稿时，可先生成固定 artifact：
  `support analysis init --chip <name>`
- 当 datasheet / 原理图需要先交给 agent 做语义解析时，可先让 agent 产出结构化 analysis artifact，再用：
  `support derive --from-analysis <path>`
- `support analysis init` 会在 `.emb-agent/analysis/` 下生成带 schema 的草稿文件，方便本地 agent 继续补全。
- `--from-analysis` 适合承接 AI 解析结果；最终落盘仍由 derive/generate 引擎完成，避免 agent 直接自由写 adapters。
