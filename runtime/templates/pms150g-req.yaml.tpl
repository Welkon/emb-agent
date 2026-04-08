goals:
  - "完成 PMS150G 的最小控制闭环，确认 Timer16、TM2 PWM 与 comparator 路径。"

features:
  - "能够稳定输出 PWM 波形并固定输出引脚。"
  - "能够给出可复现的 Timer16 周期配置。"
  - "能够给出 comparator 阈值配置并确认输入源映射。"

constraints:
  - "PMS150G 不支持 ADC，任何采样需求都必须改走外部方案或更换芯片。"
  - "TM2 PWM 输出仅支持 PA3/PA4，比较器输入复用冲突要提前规避。"
  - "bandgap 不用于 comparator 唤醒路径。"
  - "在 OTP + 小 RAM 约束下，代码路径必须优先简单可控。"

acceptance:
  - "timer/pwm/comparator 三条工具链可直接给出可执行配置候选。"
  - "至少一条板级输出路径和一条 comparator 判定路径被确认。"
  - "不支持 ADC 的边界已明确写入项目真值层与设计文档。"

failure_policy:
  - "出现时序异常时先核查 Timer16 时钟源/分频/中断位，再改业务逻辑。"
  - "出现波形异常时先核查 TM2 输出引脚映射和周期寄存器，再改控制参数。"
  - "出现比较器异常时先核查输入源与参考档位，再改状态机。"

unknowns:
  - "最终 PWM 输出脚与负载拓扑映射。"
  - "比较器是否参与唤醒，还是仅轮询。"
  - "是否需要迁移到带 ADC 的器件以支撑后续功能。"

sources:
  - "docs/PMS150G-datasheet.pdf"
