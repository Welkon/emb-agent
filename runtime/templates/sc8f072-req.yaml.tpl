goals:
  - "完成 SC8F072 最小功能闭环，确认定时、PWM、比较器、ADC 四条主路径。"

features:
  - "能够稳定输出目标 PWM 频率和占空比，并固定实际输出引脚。"
  - "能够输出稳定系统节拍或中断周期（TMR0 或 TMR2）。"
  - "能够完成至少一路 comparator 阈值判定并给出寄存器配置。"
  - "能够把 ADC 码值与电压换算闭环到固定参考源。"

constraints:
  - "TMR0 结果必须按软件重装载模型核算，不把它当硬件自动重装计时器。"
  - "PWM0~PWM3 共用周期寄存器，跨通道调整不能破坏已工作的通道。"
  - "comparator 阈值配置必须保留 RBIAS_H/RBIAS_L + LVDS 组合证据。"
  - "ADC 换算必须固定 reference-source，不允许混用口径。"

acceptance:
  - "给出可执行的 timer/pwm/comparator/adc 工具结果并落到项目真值层。"
  - "关键 pin mux 冲突已被识别并写入硬件逻辑文档。"
  - "至少一条 ADC 电压换算链路与 bench 或预期值对齐。"

failure_policy:
  - "当定时误差异常时，先核查时钟源、分频和重装载模型，再改业务逻辑。"
  - "当 PWM 波形异常时，先核查输出组选择与共享周期寄存器，不直接改控制算法。"
  - "当 ADC/comparator 与预期不符时，先核查参考源与阈值口径，不直接判为硬件故障。"

unknowns:
  - "系统最终主时钟与低功耗模式切换策略。"
  - "最终 PWM 通道分配与功率级需求。"
  - "ADC 关键采样通道和采样窗口时序。"

sources:
  - "docs/SC8F072-user-manual.pdf"
