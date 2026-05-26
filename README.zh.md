# emb-agent

<p align="center">
  <strong>AI 驱动的嵌入式固件开发工作流</strong><br>
  <sub>硬件信息写一次，AI 每次会话自动读取。</sub>
</p>

<br>

```
                                你
                                 │
                    "实现 PWM 调光，低功耗"
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │            AI  编码助手               │
              │   Pi  ·  Codex  ·  Claude  ·  Cursor │
              │                                      │
              │   已经知道:                           │
              │   • 你的 MCU 型号和封装                │
              │   • 引脚分配                          │
              │   • 外设配置                          │
              │   • 当前任务和优先级                    │
              │   • 原理图拓扑和网络                    │
              └──────────────┬───────────────────────┘
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
           /emb:next   /emb:task   /emb:schematic
                │            │            │
                └────────────┼────────────┘
                             ▼
              ┌──────────────────────────────────────┐
              │           emb-agent-rs               │
              │            纯 Rust                    │
              │                                      │
              │  ┌────────┐ ┌────────┐ ┌──────────┐ │
              │  │Session │ │  Task  │ │Schematic │ │
              │  │────────│ │────────│ │──────────│ │
              │  │ start  │ │ list   │ │ summary  │ │
              │  │ next   │ │ add    │ │ nets     │ │
              │  │ status │ │ resolve│ │ bom      │ │
              │  └────────┘ └────────┘ └──────────┘ │
              │                                      │
              │  ┌────────┐ ┌────────┐ ┌──────────┐ │
              │  │  Chip  │ │ Graph  │ │ Workflow │ │
              │  │────────│ │────────│ │──────────│ │
              │  │ diff   │ │refresh │ │ scan     │ │
              │  │ swap   │ │ query  │ │ plan  do │ │
              │  └────────┘ └────────┘ │ verify   │ │
              │                        └──────────┘ │
              └──────────────┬───────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────────────┐
              │           .emb-agent/                │
              │                                      │
              │  hw.yaml     芯片 · 引脚 · 外设       │
              │  req.yaml    目标 · 约束              │
              │  tasks/      任务跟踪                 │
              │  graph/      知识图谱                 │
              │  wiki/       长期记忆                 │
              │  cache/      解析缓存（原理图/数据手册）│
              └──────────────────────────────────────┘
```

<br>

## 工作原理

**硬件信息只写一次。** 芯片型号、引脚分配、外设配置 —— 写入 `.emb-agent/hw.yaml` 和 `.emb-agent/req.yaml`。

**之后的每次会话，AI 自动知道你的板子。** 不再反复解释。不再每次问"你用的是什么 MCU？"

**你说需求，AI 自动路由。** 从原理图分析到芯片对比到外设驱动 —— 正确的工具自动匹配。

**知识持续积累。** 每次分析、每条经验、每次数据手册查询都汇入知识图谱。AI 对你的项目理解越来越深。

---

## 流程

<p align="center">
  <strong>开始</strong> → AI 探索你的项目<br>
  <strong>锁定</strong> → 硬件信息确认<br>
  <strong>工作</strong> → 任务自动路由<br>
  <strong>学习</strong> → 知识持续积累<br>
  <strong>闭环</strong> → 验证与经验记录<br>
</p>

---

## 安装

```bash
git clone <repo> && cd emb-agent && cargo build --release
cp target/release/emb-agent-rs your-project/.<host>/emb-agent/bin/
cp runtime/bin/emb-agent.cjs      your-project/.<host>/emb-agent/bin/
```

支持 **Pi**、**Codex**、**Claude Code**、**Cursor**。

---

<p align="center">
  <sub>
    <a href="./README.md">English</a> ·
    <a href="docs/scenarios.md">使用场景</a> ·
    <a href="docs/task-model.md">任务模型</a> ·
    <a href="docs/chip-support-model.md">芯片支持</a> ·
    <a href="commands/emb/help.md">命令参考</a>
  </sub>
</p>

<p align="center">
  <sub>MIT</sub>
</p>
