# emb-agent

<p align="center">
  <strong>AI 驱动的嵌入式固件开发工作流</strong><br>
  <sub>把芯片规格、引脚分配、硬件约束写进 .emb-agent/ — AI 自动读取。<br>不再每次会话都重新解释你的板子。</sub>
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

---

## 工作原理

```
你只需要写一次硬件信息：

  .emb-agent/hw.yaml   →  MCU: CA51M550, 封装: SOP8
                          引脚: LED-W→P0.2, TOUCH→P0.3, PWM→P0.4
  .emb-agent/req.yaml  →  双路LED调光, 触摸按键输入
                          电池供电, 支持深度休眠

AI 每次会话自动读取，不再问"你用的什么芯片？"
```

```
┌──────────────────────────────────────────────────────────┐
│                     AI 助手                                │
│          Pi · Codex · Claude Code · Cursor               │
│                                                          │
│    你说: "帮我实现PWM调光"  →  AI 已经知道:                  │
│    • 芯片是 CA51M550 SOP8                                  │
│    • PWM 输出在 P0.2                                       │
│    • LED 通过 NMOS Q1 驱动                                  │
│    • 3 个待处理任务, pwm-led 是 P0 优先级                    │
└──────┬───────────────────────────────────────────────────┘
       │
       │  /emb:next  /emb:task  /emb:schematic
       ▼
┌──────────────────────────────────────────────────────────┐
│              emb-agent-rs (纯 Rust)                       │
│                                                          │
│  读取 .emb-agent/  →  注入上下文  →  路由任务              │
│                                                          │
│  session  │  task  │  schematic  │  knowledge  │  hooks  │
└──────────────────────────────────────────────────────────┘
```

## 使用流程

### 1. 项目开始 — AI 自动发现你有的东西

在 Pi/Codex/Claude/Cursor 中打开新会话。emb-agent 扫描仓库，发现硬件文档、原理图、已有代码，然后告诉你：

> *"找到了 CA51M550 数据手册和 SchDoc 原理图。需要我录入并确认 MCU 型号吗？"*

### 2. 硬件信息确认后自动锁定

MCU、引脚、外设确认后写入 `.emb-agent/hw.yaml`。此后每次会话 AI 都自动知道你的板子配置。

### 3. 你说需求 — AI 自动路由到正确的任务

```
你: "帮我写PWM调光驱动"
AI:  激活任务 pwm-led, 扫描原理图, 确认 P0.2/PWM0 引脚,
     查阅 CA51M550 数据手册的 PWM 寄存器, 然后写驱动代码。
```

```
你: "检查下原理图有没有问题"
AI:  读取已缓存的原理图分析, 展示 31 个元件、20 个网络、
     18 条建议 — 特别标注 LED 极性需确认。
```

### 4. 知识持续积累

每次原理图分析、数据手册查询、调试经验自动沉淀到知识图谱。Wiki 页面随项目演进自动增长。AI 对你的项目理解越来越深。

### 5. 任务闭环，有据可查

每个任务经过 `scan → plan → do → review → verify`，并通过 After Action Review 记录经验教训。不只是"编译过了就行"——真正的嵌入式验证流程。

---

## 安装

```bash
git clone <repo> && cd emb-agent
cargo build --release
cp target/release/emb-agent-rs your-project/.<host>/emb-agent/bin/
cp runtime/bin/emb-agent.cjs      your-project/.<host>/emb-agent/bin/
```

支持 Pi、Codex、Claude Code、Cursor。

---

## 文档

| 文档 | 说明 |
|------|------|
| [scenarios.md](docs/scenarios.md) | 真实使用场景 |
| [task-model.md](docs/task-model.md) | 任务生命周期 |
| [chip-support-model.md](docs/chip-support-model.md) | 芯片支持模型 |
| [ai-host-contract.md](docs/ai-host-contract.md) | 宿主集成协议 |
| [commands/emb/help.md](commands/emb/help.md) | 完整命令参考 |

## License

MIT
