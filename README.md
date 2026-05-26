# emb-agent

<p align="center">
  <strong>AI 驱动的嵌入式固件开发工作流</strong><br>
  <sub>把芯片规格、引脚分配、硬件约束写进仓库 — AI 自动读取，不再反复解释硬件。</sub>
</p>

<p align="center">
  <a href="./README.zh.md">中文</a>
</p>

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     AI 编码助手                           │
│         Pi · Codex · Claude Code · Cursor               │
└──────┬──────┬──────┬──────┬──────┬──────┬──────────────┘
       │      │      │      │      │      │
       │  /emb:next  /emb:task  /emb:schematic  ...
       │      │      │      │      │      │
┌──────┴──────┴──────┴──────┴──────┴──────┴──────────────┐
│                  宿主集成层                               │
│  Pi: .pi/extensions/emb-agent.ts  ← 原生扩展             │
│  Codex: .codex/hooks.json          ← 生命周期 hook        │
│  Cursor/Claude: commands/emb/*.md  ← 命令文档             │
└──────────────────────┬──────────────────────────────────┘
                       │  node emb-agent.cjs
                       ▼
┌─────────────────────────────────────────────────────────┐
│              emb-agent.cjs (59 行)                        │
│              瘦转发层 → 委托 Rust 二进制                   │
└──────────────────────┬──────────────────────────────────┘
                       │  spawnSync
                       ▼
┌─────────────────────────────────────────────────────────┐
│              emb-agent-rs (纯 Rust)                       │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐ │
│  │ session  │ │  task    │ │ schematic  │ │ hardware │ │
│  │          │ │          │ │            │ │          │ │
│  │ next     │ │ activate │ │ summary    │ │ chip     │ │
│  │ status   │ │ resolve  │ │ components │ │ board    │ │
│  │ health   │ │ aar      │ │ nets/bom   │ │ project  │ │
│  └──────────┘ └──────────┘ └────────────┘ └──────────┘ │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐ │
│  │knowledge │ │  lookup  │ │  workflow  │ │  hooks   │ │
│  │          │ │          │ │            │ │          │ │
│  │ graph    │ │ doc      │ │ scan/plan  │ │ session  │ │
│  │ wiki     │ │ component│ │ do/review  │ │ status   │ │
│  │ memory   │ │ board    │ │ verify     │ │ diag     │ │
│  └──────────┘ └──────────┘ └────────────┘ └──────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   项目文件                                │
│                                                          │
│  .emb-agent/hw.yaml       芯片、引脚、外设                 │
│  .emb-agent/req.yaml      目标、接口、约束                 │
│  .emb-agent/tasks/        任务跟踪                        │
│  .emb-agent/graph/        知识图谱                        │
│  .emb-agent/wiki/         长期知识                        │
│  .emb-agent/cache/        解析缓存 (原理图/数据手册)         │
└─────────────────────────────────────────────────────────┘
```

## 常用命令

```bash
# 会话开始 — AI 自动获取项目状态
emb-agent-rs next

# 查看项目状态
emb-agent-rs status

# 任务管理
emb-agent-rs task list               # 列出所有任务
emb-agent-rs task activate pwm-led   # 激活一个任务
emb-agent-rs task add "实现触摸按键"   # 创建新任务

# 原理图分析
emb-agent-rs schematic summary       # 原理图总览
emb-agent-rs schematic bom           # BOM 表
emb-agent-rs ingest schematic --file board.SchDoc

# 知识管理
emb-agent-rs knowledge graph refresh # 刷新知识图谱
emb-agent-rs knowledge wiki          # 查看 Wiki

# 工作流
emb-agent-rs scan                    # 分析当前任务
emb-agent-rs plan                    # 制定计划
emb-agent-rs do                      # 执行实现
```

**完整命令参考**: [commands/emb/help.md](commands/emb/help.md)

## 安装

```bash
git clone <repo>
cd emb-agent
cargo build --release
```

部署到项目：
```bash
cp target/release/emb-agent-rs your-project/.pi/emb-agent/bin/
cp runtime/bin/emb-agent.cjs      your-project/.pi/emb-agent/bin/
```

## 文档

| 文档 | 说明 |
|------|------|
| [ai-host-contract.md](docs/ai-host-contract.md) | AI 宿主集成协议 |
| [task-model.md](docs/task-model.md) | 任务生命周期 |
| [chip-support-model.md](docs/chip-support-model.md) | 芯片支持模型 |
| [scenarios.md](docs/scenarios.md) | 使用场景 |
| [product-boundaries.md](docs/product-boundaries.md) | 产品边界 |
| [automation-contract.md](docs/automation-contract.md) | 自动化输出格式 |
| [workflow-layering.md](docs/workflow-layering.md) | 工作流分层 |

## License

MIT
