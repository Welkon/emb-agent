# emb-agent

<p align="center">
  <strong>面向 AI 编码助手的嵌入式固件项目记忆</strong><br>
  <sub>硬件信息只描述一次。之后每次 AI 会话都自动带着正确的板级上下文开始。</sub>
</p>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="docs/scenarios.md">使用场景</a>
  ·
  <a href="docs/task-model.md">任务模型</a>
  ·
  <a href="docs/chip-support-model.md">芯片支持</a>
</p>

---

## 为什么需要它

嵌入式固件开发里，AI 最大的问题是：**它记不住你的板子**。

你会反复解释同样的信息：

- 用的是什么 MCU 和封装
- 哪个信号接到哪个引脚
- 哪些外设已经被占用
- 原理图里有什么约束
- 当前任务到底要做到什么程度

**emb-agent 把这些信息变成项目记忆。**

AI 助手在每次会话开始时自动读取这些记忆。你可以直接说产品需求，而不是每次重新解释硬件上下文。

---

## 架构

emb-agent 位于 AI 助手和你的代码仓库之间。它不替代 AI 助手，而是为 AI 助手提供可靠的嵌入式项目记忆。

| 层级 | 作用 | 示例 |
|---|---|---|
| **用户** | 描述产品级意图 | “把 PWM 调光 bring up 起来”、“检查原理图”、“继续当前任务” |
| **AI 助手** | 对话、写代码、澄清需求 | Pi、Codex、Claude Code、Cursor |
| **宿主集成** | 自动启动 emb-agent，并暴露项目感知能力 | Pi 扩展、Codex hooks、Claude/Cursor 命令文档 |
| **Rust Runtime** | 读取项目状态、路由工作流、分析硬件材料 | session、task、schematic、knowledge、diagnostics |
| **项目记忆** | 保存跨会话长期存在的事实 | `.emb-agent/hw.yaml`、`req.yaml`、`tasks/`、`graph/`、`wiki/`、`cache/` |

### Runtime 模块

| 模块 | 作用 |
|---|---|
| **Session** | 识别项目状态并推荐下一步 |
| **Task** | 跟踪当前工作、决策、评审和关闭状态 |
| **Schematic** | 解析并总结原理图 / 板文件 |
| **Hardware** | 保持芯片、板卡、引脚和外设上下文一致 |
| **Knowledge** | 通过知识图谱和 Wiki 形成项目记忆 |
| **Workflow** | 引导工作经过扫描、计划、实现、评审、验证 |
| **Diagnostics** | 报告 hook、项目状态和路径健康度 |

---

## 使用流程

### 1. 打开 AI 会话

在固件仓库中打开 Pi、Codex、Claude Code 或 Cursor。

如果项目还没有初始化，emb-agent 会检测到这一点，并引导 AI 自动创建 `.emb-agent/` 工作区。

### 2. 确认硬件事实

AI 会帮助收集那些不能靠猜的信息：

- MCU / 封装
- 引脚分配
- 电源与时钟假设
- 外设归属
- 原理图约束
- 产品需求

确认之后，这些事实会成为项目记忆。

### 3. 直接说产品需求

你不需要记命令。

直接说：

> “把 LED 驱动 bring up 起来。”
>
> “检查一下原理图有没有明显风险。”
>
> “继续当前任务。”
>
> “下一步该做什么？”

emb-agent 会在幕后给 AI 提供上下文和路由信息。

### 4. 按受控流程推进

典型的嵌入式工作会走同一个闭环：

1. 理解当前状态
2. 制定修改计划
3. 实现功能
4. 评审结果
5. 对照硬件和需求进行验证
6. 记录经验教训

用户看到的是正常的 AI 对话。emb-agent 在项目里维护任务状态、证据和复盘记录。

### 5. 让项目持续学习

原理图发现、数据手册事实、调试笔记、任务决策、验证结果都会沉淀到知识图谱和 Wiki。

项目使用 emb-agent 越久，你需要重复的上下文越少。

---

## 用户通常需要记住什么

几乎什么都不用记。

在项目里打开 AI 助手，然后直接描述你要做的事情。如果需要手动推动，只要问：

> “下一步该做什么？”

AI 会通过 emb-agent 读取当前状态并继续推进。

---

## 安装

通过 npm：

```bash
npx emb-agent --target pi
```

或从源码构建：

```bash
git clone <repo>
cd emb-agent
cargo build --release
```

支持宿主：**Pi**、**Codex**、**Claude Code**、**Cursor**。

---

## 文档

| 文档 | 用途 |
|---|---|
| [使用场景](docs/scenarios.md) | emb-agent 适合哪些项目情况 |
| [任务模型](docs/task-model.md) | 工作如何被跟踪和关闭 |
| [芯片支持模型](docs/chip-support-model.md) | 可复用芯片知识如何组织 |
| [AI 宿主协议](docs/ai-host-contract.md) | AI Runtime 的集成规则 |
| [自动化协议](docs/automation-contract.md) | 稳定的机器可读输出 |
| [工作流分层](docs/workflow-layering.md) | 核心能力与项目定制的边界 |
| [命令参考](commands/emb/help.md) | 面向 AI/自动化作者的完整命令面 |

---

<p align="center">
  <sub>MIT</sub>
</p>
