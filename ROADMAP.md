# emb-agent Roadmap

## 当前状态

- Phase 1 已完成
- Phase 2 已完成
- Phase 2.5 已完成
- Phase 2.6 已完成
- Phase 2.7 已完成
- Phase 2.8 已完成
- Phase 2.9 已完成
- Phase 2.10 已完成
- Phase 2.11 已完成
- Phase 2.12 已完成
- Phase 2.13 已完成
- Phase 2.14 已完成
- Phase 2.15 已完成
- Phase 2.16 已完成
- Phase 2.17 已完成
- Phase 2.18 已完成
- Phase 3 暂缓

当前优先级不是继续扩功能面，而是先保证 Codex 安装链路和 runtime 行为稳定。

## Phase 2.18: Tool Subsystem Foundation

状态：已完成

目标：

- 为后续定时器、PWM、比较器、ADC 等工具能力铺一层通用骨架
- 避免直接把工具体系绑死在应广单一厂商上
- 先把 `core + family adapter + device profile` 的结构落盘，再逐步实现计算器

范围：

- 新增 `tools/registry.json`
- 新增 `tools/specs/`
- 新增 `tools/families/`
- 新增 `tools/devices/`
- 新增 `tool list/show`、`tool family list/show`、`tool device list/show`
- 首个 family adapter 对齐 `padauk-pms15x`
- 首个 device profile 对齐 `PMS150G`

结果：

- 当前已具备“通用问题域 + family adapter + device profile”的工具子系统骨架
- 后续若接入中微等其他 MCU，不需要推翻当前结构

## Phase 1: Runtime 地基

状态：已完成

范围：

- installer-first 结构
- 安装目标对齐 `~/.codex/` / `./.codex/`
- runtime 独立于项目目录安装
- `config.json`、`session_version`、stale lock 清理
- 统一 runtime 校验与状态工具

结果：

- `emb-agent` 已具备稳定的安装、初始化、恢复和模板能力
- 项目内只保留轻量扩展目录 `emb-agent/profiles/`、`emb-agent/packs/`

## Phase 2: 轻量调度器与原生命令

状态：已完成

范围：

- 新增 scheduler，统一根据 `profile + pack + session` 做动作决策
- runtime 原生支持 `scan`、`do`、`debug`、`review`、`note`
- 输出结构化 JSON，供 skill、CLI 和后续其他 AI runtime 复用
- 增加 scheduler 与安装链路测试

结果：

- 当前系统已经不是单纯 skill 壳
- 调度逻辑已内聚到 runtime，而不是散落在命令文案里

## Phase 2.5: 轻量 Plan

状态：已完成

目标：

- 给 `emb-agent` 增加轻量 `plan`，但不回到 GSD 式厚 planning
- 在复杂嵌入式改动前，先输出一份可执行的最小计划
- 让 `plan` 成为 `scan -> plan -> do -> verify` 中的可选增强，而不是强制前置

范围：

- 新增原生命令 `plan`
- 输出轻量结构：
  - `goal`
  - `truth_sources`
  - `constraints`
  - `risks`
  - `steps`
  - `verification`
- 默认只输出终端文本或 JSON
- 默认不创建 `.planning/`
- 默认不生成 phase 文档
- 默认不引入 planner/checker 多 agent 链

触发条件：

- 改硬件行为
- 改时序、中断或共享状态
- 跨多模块改动
- RTOS 并发路径调整
- IoT 重连、升级、回滚、一致性链路修改

不触发的典型场景：

- 小文档修改
- 单点小 bug
- 已经非常明确的直接改动

边界：

- `emb plan` 是任务级 `micro-plan`
- 不是 GSD 那种阶段级 `phase-plan`
- 不承担 roadmap 管理
- 不承担长期 planning 文档沉淀

验收标准：

- 简单任务仍可直接 `scan -> do`
- 复杂任务可稳定输出一份短小、可执行、可验证的计划
- 不显著增加 token 消耗
- 不改变现有 Codex runtime 稳定性

## Phase 2.6: 嵌入式偏好层

状态：已完成

目标：

- 给 runtime 增加最小偏好层，但不引入画像系统或重状态机
- 让偏好直接影响 `next`、`resume`、`plan`
- 保持 installer、session 和现有输出契约稳定

范围：

- 新增 `preferences`
- 新增 `prefs show/set/reset`
- 让 `plan` 的真值顺序和验证强度受偏好控制
- 让 `next/resume` 的建议路由受偏好控制

边界：

- 不做通用人格画像
- 不做多轮学习型偏好推断
- 不引入额外 planning 目录

## Phase 2.7: 项目默认项与初始化闭环

状态：已完成

目标：

- 让 `emb-agent` 不只记会话状态，也能对仓库本身落稳定默认项
- 让 `init-project` 从“建空目录”升级为“建项目级默认配置和固定文档骨架”
- 让新 session 自动继承项目级 `profile/pack/preferences`

范围：

- 新增 `emb-agent/project.json`
- `init-project` 自动生成项目默认配置
- `init-project` 按项目画像生成固定文档骨架
- runtime 自动读取项目默认项
- 新增 `project show`

边界：

- 不引入项目私有 runtime
- 不引入厚项目脚手架
- 只做嵌入式需要的固定落点

## Phase 2.8: Note 落文档闭环

状态：已完成

目标：

- 让 `note` 不只输出目标文档列表，而能直接把稳定结论沉淀进去
- 保持轻量，不引入数据库、额外状态目录或复杂 schema
- 让缺失文档也能按模板自动补齐

范围：

- 新增 `note add`
- 以固定 `Emb-Agent Notes` 区块做追加式写入
- 支持 `kind`、`evidence`、`unverified`
- 目标文档缺失时自动按模板创建

边界：

- 不做复杂知识库
- 不做多文档事务
- 不做自动总结改写，只做稳定结论沉淀

## Phase 2.9: Review 落文档闭环

状态：已完成

目标：

- 让 `review` 不只输出结构化上下文，也能把 review 结果直接沉到固定文档
- 保持轻量，不引入外部审计系统或额外状态机
- 让缺失的 `REVIEW-REPORT.md` 能按模板自动补齐

范围：

- 新增 `review save`
- 自动创建并写入 `docs/REVIEW-REPORT.md`
- 沉淀 summary、findings、checks、review axes、上下文信息
- 补齐测试与安装链路验证

边界：

- 不做多轮审查编排
- 不做自动裁决
- 只做结构性 review 结果沉淀

## Phase 2.10: Scan 落文档闭环

状态：已完成

目标：

- 让 `scan` 不只输出终端上下文，也能把扫描快照直接沉到固定文档
- 保持轻量，不引入额外扫描数据库或缓存目录
- 让硬件与调试文档都能承载 scan 快照

范围：

- 新增 `scan save`
- 自动写入 `Emb-Agent Scans` 区块
- 支持 `fact`、`question`、`read`
- 补齐测试与安装链路验证

边界：

- 不做自动去重
- 不做多文档联动写入
- 只做轻量扫描快照沉淀

## Phase 2.11: Plan 落文档闭环

状态：已完成

目标：

- 让 `plan` 不只输出终端 `micro-plan`，也能把计划直接沉到固定文档
- 保持轻量，不引入 `.planning/` 或额外 plan 状态目录
- 让 `goal / truth_sources / constraints / risks / steps / verification` 可回看、可交接

范围：

- 新增 `plan save`
- 默认写入 `docs/DEBUG-NOTES.md`
- 自动写入 `Emb-Agent Plans` 区块
- 补齐测试与安装链路验证

边界：

- 不生成 phase 文档
- 不做 plan 版本树
- 只做轻量执行前计划沉淀

## Phase 2.12: 沉淀去重与项目目录绑定修正

状态：已完成

目标：

- 避免 `scan/plan/review/note` 长期反复写入同一 summary 时造成文档膨胀
- 修正安装后 CLI 在模块加载时提前固化 `cwd` 的问题
- 保持当前 Codex 安装结构和命令契约不变

范围：

- `scan save`
- `plan save`
- `review save`
- `note add`
- 项目级 `emb-agent/profiles/`
- 项目级 `emb-agent/packs/`

结果：

- 同一区块内相同 `Summary` 会执行更新式写入，而不是重复追加
- 安装后的 CLI 改为按运行时项目目录解析本地 profile 和 pack
- 增加对应回归测试，覆盖持久化去重和安装后项目级 profile 解析

## Phase 2.13: 项目内真值层轻量路线

状态：已完成

目标：

- 不引入全局 MCU 缓存、数据库或额外安装级数据目录
- 先用项目内轻量真值层降低嵌入式首启成本
- 减少 `scan/plan` 每次都从整本手册重新起步的概率

范围：

- 新增 `emb-agent/hw.yaml`
- 新增 `emb-agent/req.yaml`
- `init-project` 自动生成上述真值文件
- `scan/plan` 优先读取项目内真值层，再回落到文档和原始资料

结果：

- 项目维护者只需要维护“本项目如何使用硬件与需求”的真值，不需要维护全局 MCU 缓存
- 第一轮手册抽取结果可沉淀在项目内，后续任务优先复用
- 保持 installer 结构稳定，不新增全局持久化复杂度

## Phase 2.14: 既有工程 Attach

状态：已完成

目标：

- 让 emb-agent 更符合厂商 IDE / SDK / brownfield 工程的真实起点
- 不要求用户先手工补完整硬件与需求文档，再开始工作
- 用最小探测逻辑为 `hw.yaml / req.yaml` 自动补首批资料来源

范围：

- 新增 `attach`
- 探测已有工程中的 datasheet / schematic / code / project files
- 自动更新 `emb-agent/hw.yaml`
- 自动更新 `emb-agent/req.yaml`
- 把首批 code / project files 带入 session `last_files`

结果：

- 已有工程可以直接 attach，而不必先走“空模板 + 手工整理”模式
- `next/scan/plan` 在 attach 后就能立刻获得更真实的起点
- 保持轻量，不引入厂商工程深解析器或全局缓存

## Phase 2.15: 真值层增量摄取

状态：已完成

目标：

- 让 `hw.yaml / req.yaml` 不只是初始化模板，而能持续沉淀新确认事实
- 避免读完手册或需求后，结论只留在 Markdown 或会话里
- 保持轻量，不引入知识库服务或自动总结后台任务

范围：

- 新增 `ingest hardware`
- 新增 `ingest requirements`
- 支持把 truth / constraint / unknown / source 写入 `hw.yaml`
- 支持把 goal / feature / constraint / acceptance / failure / unknown / source 写入 `req.yaml`

结果：

- 项目真值层进入“可持续更新”状态
- `attach -> ingest -> next/scan/plan` 形成更完整的轻量闭环
- 继续保持 installer 和 runtime 结构稳定

## Phase 2.16: 硬件沉淀自动桥接

状态：已完成

目标：

- 避免用户同时记住 `scan save / note add / ingest hardware` 三套近似动作
- 让高频硬件沉淀路径默认同步到项目真值层
- 继续保持轻量，不做后台自动归纳

范围：

- `scan save hardware`
- `note add hardware --kind hardware_truth`
- 自动同步到 `emb-agent/hw.yaml`

结果：

- 用户在常用扫描/记录路径上就能顺手更新硬件真值层
- `hw.yaml` 与 `docs/HARDWARE-LOGIC.md` 更不容易脱节
- 不新增额外命令记忆负担

## Phase 2.17: 计划沉淀需求桥接

状态：已完成

目标：

- 让需求层也具备与硬件层类似的低摩擦沉淀路径
- 减少 `plan save` 之后还要手动补 `ingest requirements` 的双写
- 保持桥接策略克制，只同步最稳定的计划信息

范围：

- `plan save`
- 自动同步到 `emb-agent/req.yaml`
- 同步内容限定为目标与验证条件

结果：

- `req.yaml` 可从计划记录中持续累积目标与验收条件
- 用户在高频计划路径上不需要额外补一次 requirements ingest
- 继续保持轻量，不把风险、步骤等短期执行信息全部灌入需求层

## Phase 2.18: 轻量文档解析接入

状态：已完成

目标：

- 给 `emb-agent` 增加“先解析文档、再沉淀真值”的轻量入口
- 避免每次重新阅读整份 datasheet / 规格书
- 保持项目内缓存路线，不引入数据库或全局 MCU 知识库

范围：

- `ingest doc`
- `integrations.mineru`
- `emb-agent/cache/docs/`
- `index.json + parse.md + parse.json + facts draft`

结果：

- 项目可以把本地文档先解析进缓存，再继续走 `ingest / scan / plan`
- 解析结果按 `doc-id` 落在项目内，clear context 后仍可复用
- `--to hardware|requirements` 时会额外生成基于规则的事实草稿，降低后续真值沉淀成本
- 当前先接 MinerU 轻量 Agent 解析链路，不增加 API key 必填门槛

## Phase 2.19: 文档草稿应用到真值层

状态：已完成

目标：

- 让 `ingest doc` 产出的事实草稿可以真正进入 `hw.yaml / req.yaml`
- 保持桥接策略克制，只应用稳定字段
- 不引入数据库，也不增加重审阅流程

范围：

- `ingest apply doc <doc-id> --to hardware|requirements`
- 复用现有 truth 写入路径
- 保留项目内缓存与草稿文件

结果：

- 文档解析链路从“缓存”闭环到“真值层”
- `scan/plan` 能直接复用来自文档解析的稳定字段
- 当前只桥接 `model/package/goals/constraints/acceptance/unknowns/sources` 等稳定信息

## Phase 2.20: 文档缓存可发现性

状态：已完成

目标：

- 让用户不必手记 `doc-id`
- 让文档缓存具备最基本的可浏览能力
- 保持输出克制，只返回摘要和产物状态

范围：

- `doc list`
- `doc show <doc-id>`

结果：

- 用户可以先列出缓存文档，再查看单个文档摘要后决定是否 `ingest apply doc`
- 文档缓存从“内部实现细节”提升为可直接使用的轻量工作面
- `apply doc` 的应用状态会沉到索引里，重复应用同一份草稿时默认自动跳过

## Phase 2.21: 文档草稿选择性应用

状态：已完成

目标：

- 让用户只吸收文档草稿里最稳定的一部分字段
- 避免一次 apply 把不想要的 `model/package/goals` 一起写进真值层
- 保持幂等判断与字段选择一致

范围：

- `ingest apply doc ... --only <field1,field2>`
- `hardware / requirements` 各自限定允许字段
- 幂等签名包含字段选择

结果：

- 用户可以按字段粒度把文档草稿并入 `hw.yaml / req.yaml`
- `apply doc --only constraints,sources` 这类保守路径已经可用
- 相同文档但不同字段组合会被视为不同应用签名

## Phase 2.22: 应用前差异预览

状态：已完成

目标：

- 让用户在 apply 前先看到会改哪些字段
- 预览结果要与真实 apply 语义一致，而不是做花哨文本 diff
- 保持轻量 JSON 输出，便于其他 AI runtime 复用

范围：

- `doc diff <doc-id> --to hardware|requirements`
- 支持 `--only`
- 标记 `set / append / noop / skip`

结果：

- 用户可以先预览，再决定是否 `ingest apply doc`
- 文档链路的可控性进一步提升，误写真值层的风险下降

## Phase 3: SDK 与多 Runtime 适配

状态：暂缓

暂缓原因：

- 当前优先级是保持 Codex 安装链路和 runtime 行为稳定
- 在 Codex 侧验证完成前，不继续扩大 SDK、接口层和多 runtime 适配面
- 避免在第 2 阶段刚落地后立即引入新的兼容层，增加状态模型和安装复杂度

冻结原则：

- 不新增会影响 Codex 安装目录结构的 breaking change
- 不新增会改变现有 `scan/do/debug/review/note/resume` 输出契约的 breaking change
- 只接受稳定性修正、文档补齐、轻量测试增强和小范围兼容性修补

重启条件：

- 当前 Codex runtime 已连续稳定使用一段时间
- 命令输出结构和 session 模型被证明足够稳定
- 确认确实需要把 `emb-agent` 复用到其他 AI 工具，而不是仅停留在预留设计

第 3 阶段恢复后再考虑：

- 更多 profile，如 `baremetal-32bit`、`rtos-mcu`
- 更多 pack，如 `battery-device`、`motor-control`
- 更强的 handoff / pause / resume 智能恢复
- 更细的 `next` 路由策略与自动执行开关
- 轻量 `plan` 之外的 SDK / 接口层抽象
- 多 runtime 安装器与适配层
- 更细的 CLI 辅助输出，但仍不引入重 planning
