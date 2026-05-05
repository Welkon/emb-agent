<p align="center">
  <strong>AI 驱动的嵌入式固件开发工作流</strong><br/>
  <sub>把芯片规格、引脚分配、硬件约束写进仓库 — 让 AI 直接读懂你的硬件。</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/emb-agent"><img alt="npm" src="https://img.shields.io/npm/v/emb-agent?color=00d4ff"></a>
  <a href="https://github.com"><img alt="license" src="https://img.shields.io/badge/license-MIT-00d4ff"></a>
  <a href="./docs/README.md"><img alt="docs" src="https://img.shields.io/badge/docs-emb--agent-00d4ff"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./docs/quick-start.md">快速开始</a> ·
  <a href="./docs/platforms.md">平台说明</a> ·
  <a href="./commands/emb/help.md">命令参考</a>
</p>

---

## emb-agent 是什么？

用 AI 写嵌入式固件时，你经常要反复告诉 AI 同一件事：用的什么 MCU、引脚怎么接的、外设有哪些、时序约束是什么。emb-agent 的解决思路很简单：**把这些硬件信息写成文件放在仓库里**。

一旦硬件信息写进文件，AI 在每次会话开始时自动读取。不用再在聊天里反复解释你的板子配置。

支持 **Claude Code**、**Codex** 和 **Cursor** — 同一套 `.emb-agent/` 目录驱动所有三个平台。

### 核心功能

| 功能 | 解决了什么问题 |
|---|---|
| **硬件信息文件** | MCU 型号、封装、引脚、外设写一次到 `.emb-agent/hw.yaml`，每次会话 AI 自动读取。 |
| **需求文件** | 在 `.emb-agent/req.yaml` 中记录项目目标、接口和约束，AI 时刻知道你要做什么。 |
| **简洁的命令流** | 大多数项目跑 `scan → plan → do → verify`。快捷命令如 `emb-agent scan` / `debug` / `do` 省去 `capability run` 前缀。 |
| **内建任务追踪** | `task add` 创建任务，跟踪在 `.emb-agent/tasks/` 中，可关联 worktree 和 PR。 |
| **文档提取** | 喂入数据手册和原理图，AI 通过 MinerU 提取芯片信息（agent 限额自动 fallback 到 v4 API）。 |
| **芯片专属逻辑** | PWM、定时器、ADC、比较器计算工具以可搜索参数形式生成在 adapter 中。 |
| **内建验证** | 每个任务以 `review → verify` 关闭，不只是"编译通过就行"。 |
| **知识图谱 + Wiki** | 自动生成知识图谱连接芯片、寄存器、公式、任务。Wiki 在 graph build 时自动生成 stub 页面。 |
| **自动启动 + 状态栏** | SessionStart 自动注入上下文。状态栏实时显示硬件状态、任务数、wiki 页面、图谱新鲜度。 |
| **回复语言** | `--lang zh` 安装参数，自动写入 AGENTS.md 控制 AI 回复语言。 |

### 支持的 AI 工具

| 平台 | 安装位置 | 自动启动 | 活动追踪 |
|---|---|---|---|
| **Claude Code** | `~/.claude/` 或 `.claude/` | ✅ | ✅ |
| **Codex** | `~/.codex/` 或 `.codex/` | ✅ | ✅ |
| **Cursor** | `~/.cursor/` 或 `.cursor/` | ✅ | ✅ |

---

## 快速开始

### 1. 安装到项目中

```bash
npx emb-agent
```

这会打开交互式安装向导，问清楚你用哪个 AI 工具后自动配置好一切。一行命令直接安装（以 Claude Code 为例）：

```bash
npx emb-agent --claude --local --developer "你的名字" --lang zh
```

### 2. 打开新会话

在你的 AI 工具里打开新会话。emb-agent 自动注入项目上下文 — 不需要手动跑任何命令。首次会话会自动初始化项目并告诉你下一步做什么。

### 3. 告诉它你的硬件信息

**已知 MCU：**
```bash
declare hardware --mcu SC8F072 --package SOP8
bootstrap run --confirm
next run
```

**还没选好芯片：**
```text
在 .emb-agent/req.yaml 里写清楚项目目标和约束，然后运行 "next"
```

**信息在数据手册或原理图里：**
```bash
ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware
# 原理图
ingest schematic --file schematic.pdf
```

**能力快捷命令（bootstrap 完成后）：**
```bash
emb-agent scan      # 分诊/分析
emb-agent plan      # 制定方案
emb-agent do        # 执行修改（需先创建 task）
emb-agent debug     # 调试定位
emb-agent review    # 代码审查
emb-agent verify    # 验证闭合
```

[完整上手指南 →](./docs/quick-start.md)

---

## 安装程序创建了什么

```text
your-project/
├── AGENTS.md                    ← AI 会话启动时自动读取
├── .emb-agent/
│   ├── project.json             ← 项目设置
│   ├── hw.yaml                  ← 芯片型号、引脚、信号、外设
│   ├── req.yaml                 ← 目标、接口、验收规则
│   ├── graph/                   ← 自动生成的知识图谱
│   ├── wiki/                    ← 长期知识存储
│   ├── tasks/                   ← 任务定义和上下文
│   ├── specs/                   ← 项目专属工作流规则
│   └── formulas/                ← 芯片公式注册表
└── .claude/  (或 .codex/, .cursor/)
    ├── settings.json             ← hooks（自动注入）
    ├── commands/emb/             ← 斜杠命令，如 /emb:next
    └── agents/                   ← 专用智能体（emb-fw-doer 等）
```

---

## 自动化集成

如果你在写脚本或工具对接 emb-agent，使用这些机器可读的接口：

| 命令 | 返回内容 |
|---|---|
| `next --brief` | 紧凑 JSON，包含推荐的下一步操作 |
| `external status` | 稳定的信封格式，包含项目健康摘要 |
| `external health` | 硬件和工作流健康报告 |
| `task worktree status` | 隔离任务工作空间的状态 |

每个响应都包含**运行时事件级别**（`clear`、`ok`、`pending`、`blocked`、`failed`），方便脚本判断是否可以安全继续。

---

## 架构

emb-agent 分三层：

1. **工作流层** — 你日常使用的命令：`start`、`declare hardware`、`next`、`task`、`ingest`。引导 AI 按硬件优先的方式开发。
2. **芯片支持层** — 芯片专属的公式、寄存器映射和工具逻辑。独立维护，保持核心精简。
3. **宿主层** — 技能、hooks 和命令，让 emb-agent 适配 Claude Code、Codex 或 Cursor。

芯片支持在报告中出现时，按就绪程度分类：
- `reusable` — 已可跨项目复用
- `reusable-candidate` — 接近可复用，需审查
- `project-only` — 暂且只在当前项目中使用

---

## 更多文档

- [快速开始](./docs/quick-start.md)
- [平台差异说明](./docs/platforms.md)
- [实际场景示例](./docs/scenarios.md)
- [各层职责划分](./docs/product-boundaries.md)
- [芯片支持模型](./docs/chip-support-model.md)
- [任务生命周期](./docs/task-model.md)
- [自动化输出格式](./docs/automation-contract.md)
- [工作流定制](./docs/workflow-layering.md)
- [完整命令参考](./commands/emb/help.md)
- [发布说明](./RELEASE.md)

---

<p align="center">
  <sub>MIT · <a href="https://www.npmjs.com/package/emb-agent">npm</a> · <a href="./README.md">English</a></sub>
</p>
