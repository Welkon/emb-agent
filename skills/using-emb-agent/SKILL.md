---
name: using-emb-agent
description: Use when starting an embedded development conversation or when the user asks for bring-up, datasheet analysis, register reasoning, tool calculation, adapter generation, or architecture review. Route to the lightest emb-agent path first.
---

# using-emb-agent

你在使用 emb-agent。

这不是 superpowers 那种重流程总控。这里的要求更简单:

- 先判断当前问题属于哪一类
- 优先走最轻、最接近真值的路径
- 不要默认把任务升级成厚 planning
- 如果 tool 已经可执行，优先先跑 tool，再讨论实现

## 路由顺序

1. 如果项目还没初始化，先走 `init`
2. 如果缺 MCU 真值、封装、板级连接或需求，先补 `hw.yaml / req.yaml`
3. 如果问题本质是手册/PDF解析，先走 `ingest doc`
4. 如果问题本质是定时器 / PWM / ADC / 比较器 / LVDC / 充电参数计算，先看 `next.tool_recommendation`
5. 如果 `tool_execution.status = ready`，优先执行 `tool run ...`
6. 如果缺 adapter，优先走 `adapter bootstrap / sync / derive`
7. 如果是复杂系统级风险、选型、RTOS/IoT 架构压力测试，再走 `arch-review` 或 `review`
8. 只有在复杂实现、多步骤闭环、明显存在风险/问题时，才走轻量 `plan / debug / verify`

## 默认原则

- 真值优先于猜测
- 工具结果优先于空谈
- adapter trust 不够时，不把结果直接当真值
- clear context 风险变高前，提醒用户执行 `pause`
- clear context 之后，优先通过 `resume`、workspace、task、spec、thread 接回主线

## 首选判断

看到下面这些需求时，优先联想到对应入口：

- 芯片/封装/引脚/外设差异
  `adapter`, `tool`, `ingest doc`
- 板级 bring-up、外设异常、寄存器行为不符
  `scan`, `debug`, `tool run`, `forensics`
- 长期工作面或跨会话主题
  `workspace`, `task`, `thread`, `spec`
- 复杂系统评审、选型、量产风险
  `arch-review`, `review`

## 禁止事项

- 不要因为“要严谨”就默认启动重 planning
- 不要在明明可以先跑工具时，跳过 tool/adapters 直接空想
- 不要忽略 `adapter_health`、`quality_overview`、`recommended_action`
- 不要把 derive 生成的 draft adapter 输出直接当成最终真值
