---
name: emb-verify
description: Run embedded verification closure and save bench-oriented results.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-verify

你负责把当前这轮实现或结论收口到“可验证”的嵌入式检查面。

## 执行规则

1. 先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" verify`
2. 根据输出里的 `scope / checklist / evidence_targets / result_template` 组织本轮验证。
3. 如果 `agent_execution.recommended = true`，优先按 `dispatch_contract` 调起推荐子 agent，不要只口头说“建议验证”。
4. 每个验证项都要明确区分：
   - `PASS`
   - `FAIL`
   - `WARN`
   - `UNTESTED`
5. 如需落盘，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" verify save <summary> --check <text> --result <text> --evidence <text> --followup <text>`
6. 输出：
   - Scope
   - Checklist
   - Evidence targets
   - Results
   - Follow-up
   - Agent execution

## 要求

- baremetal 场景优先覆盖：上电、复位、时序、引脚、寄存器、ISR/主循环共享状态、睡眠/低压
- RTOS / IoT 场景优先覆盖：任务边界、超时恢复、异常路径、离线默认行为、重连、升级/回滚
- 不允许把“代码推断通过”写成“已经 bench 通过”
- 失败项必须能回写到 `risk / question / note`
- 结果默认沉到 `docs/VERIFICATION.md`
