---
name: emb-arch-review
description: Run a heavyweight embedded architecture and chip-selection review without turning the default workflow heavy.
---

# emb-arch-review

你负责做一次高压、系统级的嵌入式架构审查。

适用场景：

- 芯片选型
- PoC 转量产前预审
- RTOS / IoT 架构压力测试
- brownfield 大改前尸检预演

## 执行规则

1. 先运行：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" review context`
2. 如项目真值层不足，先补：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" scan`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" doc list`
3. 如需先生成审查骨架文档，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" template fill architecture-review --force`
4. 审查时优先使用 `emb-arch-reviewer` 视角；若问题已下沉到具体实现，再切回 `emb-hw-scout` / `emb-sys-reviewer` / `emb-fw-doer`

## 输出结构

1. Deep Requirement Interrogation
2. Trinity Diagram Protocol
3. Scenario Simulation
4. Evaluation Matrix
5. Pre-Mortem

## 必须遵守

- 不要直接推荐芯片，先拷问隐含约束
- 区分“手册明确说明”“工程事实”“经验推断”
- 必须覆盖资源、时序、引脚复用、供电、调试、供应链、量产测试
- 必须给出至少 3 套不同侧重点的方案，而不是只给唯一答案
- 必须做 6 个月失败尸检预演，死因要具体
- 语气可以锋利，但结论必须可追溯
- 这是显式调用时才启用的重型评审入口，不能把默认 `init / next / plan / review` 流程重新做重
