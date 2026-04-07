---
name: emb-workspace
description: Manage visible project workspaces in .emb-agent/workspace so long-lived working surfaces survive context clears cleanly.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-workspace

你负责管理项目内可见的轻量 workspace。

- workspace 不是 phase，也不是 task
- workspace 表示一个长期工作面，例如某个子系统、某块板、某条流程或某个领域
- workspace 放在 `./.emb-agent/workspace/<name>/`
- clear context 后，agent 可以通过 active workspace 更快接回主线

## Runtime

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs workspace list
node ~/.codex/emb-agent/bin/emb-agent.cjs workspace add <summary> [--type subsystem|board|flow|domain]
node ~/.codex/emb-agent/bin/emb-agent.cjs workspace show <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs workspace activate <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs workspace refresh <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs workspace link <workspace> <task|spec|thread> <name>
node ~/.codex/emb-agent/bin/emb-agent.cjs workspace unlink <workspace> <task|spec|thread> <name>
```

## 适用场景

- 你在长期推进一个子系统，例如电源、充电、IR、无线、升级链路
- 你希望把“当前主工作面”固定下来，而不是只靠 `focus` 或最近文件
- 项目需要像 Trellis 一样有用户可见的工作区目录，但仍保持轻量
- 你希望把某个 workspace 显式挂到 `task/spec/thread`，形成稳定挂载关系

## 规则

1. workspace 负责长期主题收口，不替代 task 的局部执行上下文。
2. 一个 workspace 下可以挂多个 task / spec / thread，但不要把它做成厚 planning。
3. 如果这是当前主线，执行 `workspace activate <name>`，让 `resume / manager / session hook` 自动带出它。
4. 如果某个 task/spec/thread 属于这个长期工作面，用 `workspace link` 显式挂进去，不要只靠口头约定。
5. 如果你已经在当前主线上工作了一段时间，执行一次 `workspace refresh <name>`，把 session 里的最近文件、问题、风险和可识别的 task/thread/spec 自动吸收进去。

## 输出要求

- 说明你创建、查看、列出或激活了哪个 workspace
- 说明该 workspace 当前覆盖的工作面
- 如果需要继续推进，直接指出应先读 `notes.md` 还是其关联 task / spec
