<div align="center">

# emb-agent

**一套面向嵌入式项目的轻量 agent 系统。**

**解决嵌入式项目里的上下文膨胀、手册重复阅读、芯片知识散落、工具能力不可复用。**

```bash
npx emb-agent --global
```

**支持安装到 `Codex` 与 `Claude Code`，也支持全局或当前项目本地安装。**

[快速开始](#快速开始) · [工作原理](#工作原理) · [命令](#命令) · [配置](#配置) · [发布](./RELEASE.md)

</div>

---

## 我为什么做这个

嵌入式项目和普通应用开发不一样。

你面对的不是纯代码，而是：

- 芯片资料
- 引脚和电路连接
- 时序约束
- 外设公式
- 中断与主循环行为
- RTOS 任务关系
- 量产前必须反复确认的硬件真值

问题是，大多数 AI 开发流都不擅长这类工作。

它们容易反复读整本手册，反复问同样的问题，或者把项目做成很厚的流程系统。对小 MCU、裸机、brownfield 工程，这会很快变成负担。

`emb-agent` 的目标不是把流程做重，而是把复杂性放进系统里，把用户看到的入口尽量压轻：

- 用 `init` 接入现有工程
- 用 `health` 先判断当前状态是不是可信
- 用 `hw.yaml / req.yaml` 沉淀真值
- 用 `next` 给出下一步
- 对公式 / 外设 / 引脚 / 寄存器问题，优先让 `next -> dispatch/orchestrate` 给出 `tool_recommendation / tool_execution`
- 用 `pause / resume` 解决 clear context
- 用 adapter 承载芯片差异和计算工具

---

## 适合谁

适合这些项目：

- 8 位 / 32 位 MCU 固件
- 裸机 `main loop + ISR`
- RTOS 工程
- IoT / connected appliance
- 已由厂商 IDE、CubeMX、SDK、历史仓库初始化过的 brownfield 工程

适合这些人：

- 不想每次都重新喂整本手册的人
- 想把 MCU / board / timing / power / review 事实沉下来的人
- 想要轻量化 agent 流程，而不是厚 planning 系统的人
- 想把芯片工具能力做成可复用 adapter 的人

---

## 快速开始

要求：

- Node.js `>= 18`

全局安装：

```bash
npx emb-agent --global
```

显式安装到 Claude Code：

```bash
npx emb-agent --claude --global
```

本地安装：

```bash
npx emb-agent --local
```

自定义 runtime 配置目录：

```bash
npx emb-agent --global --config-dir /path/to/runtime-home
```

如果 npm 包暂时不可用，也可以直接从 Git 安装：

```bash
npx github:Welkon/emb-agent --global
```

验证安装：

- 在安装后的运行时里调用 `emb-help`
- 或直接运行 runtime CLI，例如：
  `node <runtime-home>/emb-agent/bin/emb-agent.cjs help`
  其中 `Codex -> ~/.codex`，`Claude Code -> ~/.claude`

安装完成后：

- runtime 本体在 `<runtime-home>/emb-agent/`
- 会话状态在 `<runtime-home>/state/emb-agent/projects/`
- `Codex -> ~/.codex`
- `Claude Code -> ~/.claude`

### 保持更新

需要更新时，直接重新安装：

```bash
npx emb-agent --global
```

当前运行时会在 `SessionStart` 后台检查新版本，并在检测到以下情况时给出提醒：

- 有新版本可更新
- hooks / runtime / skills 版本不一致，属于 `stale install`

也可以显式查看：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs update
```

### 第一次进入项目

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs init
node <runtime-home>/emb-agent/bin/emb-agent.cjs health
node <runtime-home>/emb-agent/bin/emb-agent.cjs next
```

如果需要把手册或 PDF 先转进项目缓存：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU-datasheet.pdf --provider mineru --kind datasheet --to hardware
```

如果后续继续当前项目：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs next
```

如果准备 clear context：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs pause
node <runtime-home>/emb-agent/bin/emb-agent.cjs resume
```

---

## 工作原理

### 1. 接入项目

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs init
```

这一步会：

- 创建 `emb-agent/project.json`
- 创建 `emb-agent/hw.yaml`
- 创建 `emb-agent/req.yaml`
- 创建项目级缓存目录
- 按当前 profile / pack 创建 `docs/` 下的固定骨架文档
- 为已有工程建立最小工作上下文

默认 profile / pack 下，通常会创建：

- `docs/HARDWARE-LOGIC.md`
- `docs/DEBUG-NOTES.md`

`init` 是唯一官方初始化入口。

---

### 2. 沉淀真值

嵌入式项目最重要的是“已经确认的事实”。

`emb-agent` 把这层拆成两类：

- `hw.yaml`
  MCU、板级连接、引脚、外设、约束、unknowns
- `req.yaml`
  目标、功能、约束、验收、failure mode

文档导入后，可以继续把稳定信息吸收到真值层，而不是每次重新读整本资料。

常用入口：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs ingest hardware --truth "PWM 输出走 PA3" --source docs/xxx.md
node <runtime-home>/emb-agent/bin/emb-agent.cjs ingest requirements --constraint "上电 100ms 内完成初始化" --source docs/req.md
node <runtime-home>/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU.pdf --provider mineru --kind datasheet --to hardware
```

---

### 3. 进入轻量主流程

日常主线不是厚 planning，而是：

1. `next`
2. `scan`
3. `plan`
4. `do`
5. `debug`
6. `review`

`next` 会根据当前项目状态、真值层、最近文件、风险和问题，给出最合适的下一步。

如果当前问题更像定时器 / PWM / ADC / 比较器 / 引脚 / 寄存器公式定位，`next` 不只会建议 `scan`，还会带首选 `tool_recommendation`。这时再看 `dispatch next` 或 `orchestrate`：

- 若 `tool_execution.status = ready`，先跑 `tool run ...`
- 再继续 `scan` 的阅读、整合和落盘
- 不要跳过工具草案直接空谈公式

如果你只记一条链路，就记这个：

1. `init`
2. `ingest`
3. `next`
4. 按需进入 `scan / plan / do / debug / review`
5. 上下文过重时 `pause -> clear -> resume`

---

### 4. 控制上下文膨胀

这是 `emb-agent` 的重点之一。

它通过两层机制防止“会话越跑越重”：

- 项目侧上下文卫生判断
  基于最近文件、open questions、known risks、当前 focus
- 运行时 hook 提醒
  在 `PostToolUse` 时读取上下文指标，接近上限时提醒 `pause`

当上下文变重时，系统会引导你：

```text
pause -> clear -> resume
```

如果已经有 handoff，则直接：

```text
clear -> resume
```

---

### 5. 用 adapter 扩展芯片能力

`emb-agent` 的 core 故意保持抽象，不内置任何厂商绑定。

core 提供的是：

- 通用命令流
- 状态和 handoff
- 轻量调度
- tool spec
- chip/profile/pack 扩展入口

具体芯片能力通过 adapter 提供，例如：

- 定时器计算
- PWM 计算
- 比较器阈值计算
- family / device 寄存器边界
- chip profile
- package / pin / mux 结构化资料

常用入口：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs adapter source add vendor-pack --type git --location https://example.com/vendor-pack.git --branch main --subdir emb-agent
node <runtime-home>/emb-agent/bin/emb-agent.cjs adapter sync vendor-pack
node <runtime-home>/emb-agent/bin/emb-agent.cjs adapter derive --family vendor-family --device vendor-device --chip vendor-chip --tool timer-calc --package sop8 --pin-count 8
node <runtime-home>/emb-agent/bin/emb-agent.cjs adapter derive --from-project
node <runtime-home>/emb-agent/bin/emb-agent.cjs adapter derive --from-doc <doc-id> --vendor Padauk
node <runtime-home>/emb-agent/bin/emb-agent.cjs tool list
node <runtime-home>/emb-agent/bin/emb-agent.cjs tool run timer-calc --family FAMILY_NAME --device DEVICE_NAME --timer TIMER_NAME --clock-source CLOCK_SOURCE --clock-hz 16000000 --prescaler 16 --interrupt-bit 10 --target-us 560
```

---

## 命令

README 只保留命令分组，不展开每个子命令的长列表。完整命令请看：

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs help
```

### 核心工作流

- `init`
- `next`
- `scan`
- `plan`
- `do`
- `debug`
- `review`
- `arch-review`
- `orchestrate`

### 真值与文档

- `ingest hardware`
- `ingest requirements`
- `ingest doc`
- `doc list/show/diff`
- `note`

### 配置与画像

- `project show/set`
- `profile list/show/set`
- `pack list/show/add/remove/clear`
- `prefs show/set/reset`

### adapter / tool / chip

- `adapter status/source/sync/derive`
- `tool list/show/run`
- `tool family/device`
- `chip list/show`

### 会话与调度

- `pause/show/clear`
- `resume`
- `dispatch show/next`
- `dispatch next` 会在 scan 命中可执行工具时额外给出 `tool_execution`
- `schedule show`
- `orchestrate` 会在需要时切到 `inline-tool-first`
- `template list/show/fill`
- `focus`
- `last-files`
- `question`
- `risk`

---

## 配置

### 运行时安装目录

运行时结构在两种宿主下基本一致，只是宿主配置文件不同：

```text
<runtime-home>/
├── skills/
├── agents/
├── state/
│   └── emb-agent/
├── emb-agent/
│   ├── bin/
│   ├── lib/
│   ├── hooks/
│   ├── templates/
│   ├── profiles/
│   ├── packs/
│   ├── tools/
│   ├── chips/
│   ├── adapters/
│   ├── extensions/           [optional, lazy-created]
│   ├── config.json
│   └── VERSION
└── <host-config>
```

其中：

- `emb-agent/`
  放 runtime 本体
- `state/emb-agent/projects/`
  放 session、handoff、lock
- `extensions/`
  仅在 `adapter sync`、`adapter derive`、`template fill` 或首次写扩展 registry 时创建
- `skills/`
  安装命令 skill
- `agents/`
  安装可复用 agent
- `config.toml / settings.json`
  由宿主 runtime 接管 hooks 或 agent 注册

宿主映射：

- `Codex -> <runtime-home>=~/.codex, <host-config>=config.toml`
- `Claude Code -> <runtime-home>=~/.claude, <host-config>=settings.json`

### 项目目录

项目里只保留轻量扩展和真值层：

```text
<repo>/
├── docs/
└── emb-agent/
    ├── project.json
    ├── hw.yaml
    ├── req.yaml
    ├── cache/
    ├── adapters/
    ├── extensions/           [optional, lazy-created]
    ├── profiles/
    └── packs/
```

说明：

- `extensions/` 不再由 `init` 预创建
- 首次执行 `adapter sync`、`adapter derive`、`template fill tool-family/device/chip-profile` 或首次写扩展 registry 时才会生成

### profile 和 pack

`profile` 描述项目运行画像，例如：

- 裸机还是 RTOS
- 并发模型
- 资源优先级
- review 轴

`pack` 描述场景叠加，例如：

- sensor-node
- connected-appliance

它们共同决定：

- 搜索优先级
- review 重点
- notes 目标
- 默认 agent 组合

### State

`state` 是安装态的轻量持久化层，不属于项目交付物。

关键文件：

- `runtime/state/default-session.json`
  默认 session 模板
- `<runtime-home>/state/emb-agent/projects/<project-key>.json`
  项目 session
- `<runtime-home>/state/emb-agent/projects/<project-key>.handoff.json`
  `pause / resume` handoff

`project-key` 按项目路径计算，所以同一个 runtime 可以并行记住多个仓库。

---

## 文档解析

当前 `ingest doc` 支持 `mineru` provider。

推荐做法：

- token 放环境变量或 `.env`
- 文档先进入缓存，再选择性写回真值层
- 小文档走轻量链路，大文档按阈值切 API

示例：

```bash
export MINERU_API_KEY=<your-token>
node <runtime-home>/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU-datasheet.pdf --provider mineru --kind datasheet --to hardware
```

---

## 故障排除

常见情况：

- `next` 没法给出合理下一步
  先补 `hw.yaml / req.yaml` 或先执行一次 `scan`
- `tool run` 返回 `adapter-required`
  当前还没同步到对应 adapter
- clear context 后接不上
  先检查是否执行过 `pause`，再执行 `resume`
- SessionStart 提示 `stale install`
  重新跑一次安装，让 hooks / runtime / skills 对齐

### 卸载

全局卸载：

```bash
npx emb-agent --global --uninstall
```

本地卸载：

```bash
npx emb-agent --local --uninstall
```

---
