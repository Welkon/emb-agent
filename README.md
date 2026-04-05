<div align="center">

# emb-agent

**一套面向嵌入式项目的轻量 agent 系统。**

**解决嵌入式项目里的上下文膨胀、手册重复阅读、芯片知识散落、工具能力不可复用。**

```bash
npx emb-agent --global
```

**支持全局安装到 `~/.codex/`，也支持本地安装到当前项目。**

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
- 用 `hw.yaml / req.yaml` 沉淀真值
- 用 `next` 给出下一步
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

本地安装：

```bash
npx emb-agent --local
```

自定义 Codex 目录：

```bash
npx emb-agent --global --config-dir /path/to/codex-home
```

如果 npm 包暂时不可用，也可以直接从 Git 安装：

```bash
npx github:Welkon/emb-agent --global
```

验证安装：

- Codex 内运行 `$emb-help`
- 或直接运行 `node ~/.codex/emb-agent/bin/emb-agent.cjs help`

安装完成后，runtime 默认在：

```text
~/.codex/emb-agent/
```

项目运行态状态默认在：

```text
~/.codex/state/emb-agent/projects/
```

### 保持更新

需要更新时，直接重新安装：

```bash
npx emb-agent --global
```

当前运行时会在 `SessionStart` 后台检查新版本，并在检测到以下情况时给出提醒：

- 有新版本可更新
- hooks / runtime / skills 版本不一致，属于 `stale install`

### 第一次进入项目

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs init
node ~/.codex/emb-agent/bin/emb-agent.cjs next
```

如果需要把手册或 PDF 先转进项目缓存：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU-datasheet.pdf --provider mineru --kind datasheet --to hardware
```

如果后续继续当前项目：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs next
```

如果准备 clear context：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs pause
node ~/.codex/emb-agent/bin/emb-agent.cjs resume
```

---

## 工作原理

### 1. 接入项目

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs init
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
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest hardware --truth "PWM 输出走 PA3" --source docs/xxx.md
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest requirements --constraint "上电 100ms 内完成初始化" --source docs/req.md
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU.pdf --provider mineru --kind datasheet --to hardware
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

常用入口：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source add vendor-pack --type git --location https://example.com/vendor-pack.git --branch main --subdir emb-agent
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync vendor-pack
node ~/.codex/emb-agent/bin/emb-agent.cjs tool list
node ~/.codex/emb-agent/bin/emb-agent.cjs tool run timer-calc --family FAMILY_NAME --device DEVICE_NAME --timer TIMER_NAME --clock-source CLOCK_SOURCE --clock-hz 16000000 --prescaler 16 --interrupt-bit 10 --target-us 560
```

---

## 为什么有效

### 真值优先

嵌入式项目最怕的是“看起来像知道，实际上没确认”。

`emb-agent` 把已确认硬件事实和需求事实单独落到项目里，后续流程优先消费它们，而不是继续猜。

### 轻量 micro-plan

不是每个问题都值得拉出一套重 planning。

对 8 位 MCU、裸机和板级闭环，小而准的 `micro-plan` 更实用。

### adapter-first

芯片差异属于外部知识，不该硬编码进 core。

这让 `emb-agent` 可以保持通用，同时把真实 MCU 能力下沉到 adapter 仓库。

### 面向上下文衰减设计

会话状态、handoff、context hygiene、hook 提醒、resume 链路，都是为了解决长会话质量下降。

### brownfield 友好

很多嵌入式项目不是从空目录开始，而是从厂商工程、SDK、IDE 工程接入。

`emb-agent` 默认就是沿着这个现实去设计的。

---

## 命令

### 核心工作流

- `init`
- `status`
- `next`
- `scan`
- `plan`
- `do`
- `debug`
- `review`
- `arch-review`
- `resolve`

### 真值与文档

- `ingest hardware`
- `ingest requirements`
- `ingest doc`
- `ingest apply doc`
- `doc list`
- `doc show`
- `doc diff`
- `note`

### 配置与画像

- `config show`
- `project show`
- `project set`
- `profile list`
- `profile show`
- `profile set`
- `pack list`
- `pack show`
- `pack add`
- `pack remove`
- `pack clear`
- `prefs show`
- `prefs set`
- `prefs reset`

### adapter / tool / chip

- `adapter status`
- `adapter source list`
- `adapter source show`
- `adapter source add`
- `adapter source remove`
- `adapter sync`
- `tool list`
- `tool show`
- `tool run`
- `tool family list`
- `tool family show`
- `tool device list`
- `tool device show`
- `chip list`
- `chip show`

### 会话与调度

- `pause`
- `pause show`
- `pause clear`
- `resume`
- `dispatch show`
- `dispatch next`
- `schedule show`
- `session show`
- `template list/show/fill`
- `review context`
- `review axes`
- `note targets`
- `focus get`
- `focus set`
- `last-files list/add/remove/clear`
- `question list/add/remove/clear`
- `risk list/add/remove/clear`

完整帮助：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs help
```

---

## 配置

### 运行时安装目录

默认安装结构：

```text
<codex-home>/
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
│   ├── extensions/
│   ├── config.json
│   └── VERSION
└── config.toml
```

其中：

- `emb-agent/`
  放 runtime 本体
- `state/emb-agent/projects/`
  放 session、handoff、lock

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
    ├── extensions/
    ├── profiles/
    └── packs/
```

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
- `<codex-home>/state/emb-agent/projects/<project-key>.json`
  项目 session
- `<codex-home>/state/emb-agent/projects/<project-key>.handoff.json`
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
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU-datasheet.pdf --provider mineru --kind datasheet --to hardware
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

## 开发与发布

仓库内常用命令：

```bash
npm test
npm run release:check
npm pack --dry-run
```

当前采用手动发布模式。

发布前先看：

- [RELEASE.md](./RELEASE.md)
- [ROADMAP.md](./ROADMAP.md)
- [runtime/README.md](./runtime/README.md)
