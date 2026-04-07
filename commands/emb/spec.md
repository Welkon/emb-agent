---
name: emb-spec
description: Manage lightweight project specs in .emb-agent/specs so long-lived contracts stay visible and reusable.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-spec

你负责管理项目内可见的轻量 spec 库。

- spec 不等于 phase，也不等于厚 planning
- spec 用来沉淀长期复用的约束、接口合同、功能定义或流程约定
- spec 放在 `./.emb-agent/specs/`，用户可以直接查看和修改

## Runtime

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs spec list
node ~/.codex/emb-agent/bin/emb-agent.cjs spec add <summary> [--type feature|hardware|workflow|interface]
node ~/.codex/emb-agent/bin/emb-agent.cjs spec show <name>
```

## 适用场景

- 某个功能块有长期稳定的行为合同，需要跨任务复用
- 某个硬件接口、通信时序或板级限制需要独立沉淀
- 想把 task 之上的长期规范和 task 之下的局部上下文分开

## 规则

1. spec 只写长期复用的信息，不写一次性调试噪音。
2. task 解决当前问题，spec 沉淀长期合同，两者不要混用。
3. 优先把“会反复引用的接口、约束、验收口径”写进 spec。

## 输出要求

- 说明你新增、查看或列出了哪些 spec
- 如果新增了 spec，说明它后续应该被哪些 task 或实现复用
