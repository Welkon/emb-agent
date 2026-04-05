# emb-agent

`emb-agent` 是一套面向嵌入式项目的轻量 agent 安装系统。

它采用安装优先的轻量运行方式，重点放在：

- 已有嵌入式工程接入
- 硬件真值层沉淀
- 轻量 `scan / plan / do / debug / review`
- clear context 前后的 `pause / resume`
- 外部 adapter 驱动的芯片工具与资料扩展

它不是只面向某一类项目。8 位裸机、RTOS、IoT、brownfield 厂商 IDE 工程都可以接。

更多信息：

- 发布流程见 [RELEASE.md](./RELEASE.md)
- 演进路线见 [ROADMAP.md](./ROADMAP.md)
- runtime 目录说明见 [runtime/README.md](./runtime/README.md)

## 定位

- `installer-first`：先安装到 AI runtime，再进入项目使用
- `runtime-in-codex-home`：核心 runtime 安装到 `.codex/emb-agent/`
- `micro-plan`：保留轻量规划，不引入厚状态目录
- `abstract-only core`：core 不内置任何厂商绑定、family/device/chip 公式实现
- `adapter-first`：芯片差异、公式、寄存器边界、文档索引通过外部 adapter 提供

一句话说清楚：

`emb-agent` 负责通用流程和状态管理，具体 MCU 能力由外部 adapter 填进去。

## 适合什么项目

- 8 位 / 32 位 MCU 固件
- 裸机主循环 + ISR 项目
- 带 RTOS 的任务型工程
- IoT / connected appliance
- 已经由厂商 IDE、CubeMX、SDK 或历史仓库初始化过的 brownfield 工程

## 安装

要求：

- Node.js `>= 18`

全局安装到 `~/.codex/`：

```bash
npx emb-agent --global
```

本地安装到当前目录 `./.codex/`：

```bash
npx emb-agent --local
```

自定义 Codex 目录：

```bash
npx emb-agent --global --config-dir /path/to/codex-home
```

从 Git 仓库直接安装：

```bash
npx github:<you>/emb-agent --global
```

卸载：

```bash
npx emb-agent --global --uninstall
```

## 安装后会得到什么

安装后会在 Codex 目录下生成三层内容：

- `skills/emb-*`
  轻量入口壳，给上层 AI runtime 调用
- `agents/emb-*.toml`
  子 agent 定义
- `emb-agent/`
  真正工作的 runtime

运行时主体大致如下：

```text
<codex-home>/
├── skills/
├── agents/
├── emb-agent/
│   ├── bin/
│   ├── lib/
│   ├── templates/
│   ├── profiles/
│   ├── packs/
│   ├── tools/
│   ├── chips/
│   ├── adapters/
│   ├── extensions/
│   └── state/
└── config.toml
```

安装时还会生成 `.env.example`：

- 全局安装时落在 `~/.codex/.env.example`
- 本地安装时落在当前项目根目录 `.env.example`

## 最短使用流程

第一次进入项目：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs init
node ~/.codex/emb-agent/bin/emb-agent.cjs next
```

如果需要把手册解析进项目缓存：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU-datasheet.pdf --provider mineru --kind datasheet --to hardware
```

后续继续当前项目：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs next
```

清上下文前做 handoff：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs pause
node ~/.codex/emb-agent/bin/emb-agent.cjs resume
```

这里的原则是：

- `init` 是唯一官方初始化入口
- `next` 是默认入口，优先给出下一步
- 真值先沉到项目里，再做后续 scan/plan/review

## 日常命令

最常用的一组：

- `init`
- `next`
- `ingest hardware`
- `ingest requirements`
- `ingest doc`
- `scan`
- `plan`
- `do`
- `debug`
- `review`
- `arch-review`
- `pause`
- `resume`

如果你只记一条主线，就记这个：

1. `init`
2. `ingest`
3. `next`
4. 需要时进入 `scan / plan / do / debug / review`
5. 上下文变重时 `pause -> clear -> resume`

## 命令分层

日常主流程：

- `status`
- `next`
- `scan`
- `plan`
- `do`
- `debug`
- `review`
- `arch-review`
- `resolve`

真值与文档：

- `ingest hardware`
- `ingest requirements`
- `ingest doc`
- `ingest apply doc`
- `doc list`
- `doc show`
- `doc diff`
- `note`

项目配置：

- `project show`
- `project set`
- `profile list/show/set`
- `pack list/show/add/remove/clear`
- `prefs show/set/reset`

扩展与工具：

- `adapter status`
- `adapter source add/remove/list/show`
- `adapter sync`
- `tool list/show/run`
- `tool family list/show`
- `tool device list/show`
- `chip list/show`
- `template list/show/fill`

自省与调度输出：

- `dispatch show`
- `dispatch next`
- `schedule show`
- `session show`
- `agents list/show`
- `commands list/show`

完整帮助：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs help
```

## Profile 和 Pack 是什么

`profile` 描述项目的基础运行画像，例如：

- 运行模型
- 并发模型
- 资源优先级
- 搜索优先级
- review 轴
- 默认 agent

例如内置的 `baremetal-8bit` 会强调：

- `rom`
- `ram`
- `stack`
- `isr_time`

`pack` 是场景叠加层，不改变 core，只补充：

- 当前场景的关注点
- 附加 review 轴
- 推荐记录的 notes 目标
- 默认 agent 增量

例如 `sensor-node` 会增加：

- `sampling`
- `timing`
- `calibration`
- `low_power`

## Adapter 模型

这是 `emb-agent` 最重要的边界。

core 只提供：

- 抽象命令流
- 调度与状态
- 工具 spec
- 空 registry

core 不提供：

- 某厂商 timer 计算器实现
- 某 family 的寄存器边界
- 某 chip 的 pin map / peripheral profile

这些都应通过 adapter 注入。

adapter 可以来自：

- 项目本地路径
- 外部 Git 仓库

典型操作：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter source add vendor-pack --type git --location https://example.com/vendor-pack.git --branch main --subdir emb-agent
node ~/.codex/emb-agent/bin/emb-agent.cjs adapter sync vendor-pack
node ~/.codex/emb-agent/bin/emb-agent.cjs tool list
node ~/.codex/emb-agent/bin/emb-agent.cjs tool run timer-calc --family FAMILY_NAME --device DEVICE_NAME --timer TIMER_NAME --clock-source CLOCK_SOURCE --clock-hz 16000000 --prescaler 16 --interrupt-bit 10 --target-us 560
```

`tool run` 只有在检测到对应 adapter 后才会真正执行，否则稳定返回 `adapter-required`。

运行时扩展目录：

```text
~/.codex/emb-agent/
├── adapters/
└── extensions/
    ├── tools/
    └── chips/
```

项目级扩展目录：

```text
<repo>/emb-agent/
├── adapters/
└── extensions/
    ├── tools/
    └── chips/
```

## 项目侧会生成什么

`emb-agent` 不会把整套 runtime 塞进项目，只会放轻量项目产物：

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

各自职责：

- `emb-agent/project.json`
  项目默认配置，包含 profile、pack、adapter source、integration 偏好
- `emb-agent/hw.yaml`
  硬件真值层，记录 MCU、引脚、外设、约束、unknowns
- `emb-agent/req.yaml`
  需求真值层，记录目标、约束、验收和 failure mode
- `emb-agent/cache/docs/`
  手册解析缓存
- `emb-agent/cache/adapter-sources/`
  Git adapter source 本地缓存

## State 是干什么的

`state` 是 runtime 的轻量持久化层，用来让当前项目在 clear context 后还能接上。

它不属于项目交付物，而是安装态本地状态。

关键文件：

- `runtime/state/default-session.json`
  默认 session 模板，会随仓库发布
- `runtime/state/projects/<project-key>.json`
  当前项目的 session 持久化
- `runtime/state/projects/<project-key>.handoff.json`
  `pause / resume` 的 handoff 文件

`project-key` 是按项目路径算出来的，所以同一个安装 runtime 可以同时记住多个仓库。

这层状态用于保存：

- 当前 profile
- 当前 packs
- focus
- last files
- open questions
- known risks
- clear context 前的 handoff 信息

当前仓库已经把 `runtime/state/projects/*` 视为运行时缓存，不再应该提交进 Git。

## 文档解析与 MinerU

当前 `ingest doc` 支持 `mineru` provider。

推荐做法：

- API key 放 `.env` 或环境变量
- 不要硬编码进项目配置
- 小文档优先走 agent
- 大文档按页数和文件大小阈值自动切 API

示例：

```bash
export MINERU_API_KEY=<your-token>
node ~/.codex/emb-agent/bin/emb-agent.cjs ingest doc --file docs/MCU-datasheet.pdf --provider mineru --kind datasheet --to hardware
```

## 对上层 AI runtime 的关系

`emb-agent` 不是单独 skill。

更准确地说：

- 安装包负责把技能入口、子 agent、runtime 一起装好
- skill 只是入口壳
- 真正的状态、调度、输出结构都在 `emb-agent/bin/emb-agent.cjs`

因此它既能给 Codex 用，也能被其他 AI runtime 复用。

## 开发与发布

仓库内最常用的开发命令：

```bash
npm test
npm run release:check
npm pack --dry-run
```

如果你要发布或检查发布内容：

- 看 [RELEASE.md](./RELEASE.md)
- 先跑 `npm run release:check`

## 当前边界

`emb-agent` 当前已经覆盖：

- 通用嵌入式工作流
- 轻量 session / handoff
- 文档解析接入
- adapter source 管理
- 抽象工具入口
- profile / pack / chip 扩展入口

它当前刻意不做：

- 把厂商知识硬编码进 core
- 内置所有 MCU 工具实现
- 把项目状态写成厚重的流程系统

如果你要补具体芯片能力，正确方向是补 adapter 仓库，而不是继续把 core 做重。
