---
name: emb-forensics
description: Diagnose why the current emb-agent workflow is stuck, noisy, or drifting using lightweight evidence from session, handoff, files, and git state.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-forensics

你负责对当前 emb-agent 工作现场做一次轻量取证，而不是生成厚 planning。

## 执行规则

1. 直接运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" forensics [problem description]`
2. 重点检查：
   - 是否存在未消费的 handoff
   - 是否有未决问题、风险或丢失的最近文件
   - 真值层是否缺失
   - 当前上下文是否已经过重
   - 是否已有未关闭的 thread
   - 当前这次取证是否应该自动挂到一个可继续跟踪的 thread
3. 结果必须基于当前 session、handoff、项目文件和可获取的 git 状态，不要凭空编造根因。

## 输出要求

- 说明生成了哪个 forensics 报告
- 说明是否关联或创建了哪个 thread
- 给出主要 findings
- 标出建议的下一步，而不是只报错不收口
