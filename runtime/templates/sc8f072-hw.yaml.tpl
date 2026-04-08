mcu:
  vendor: "SCMCU"
  model: "SC8F072"
  package: "sop8"

board:
  name: "{{BOARD_NAME}}"
  target: "{{TARGET_NAME}}"

sources:
  datasheet:
    - "docs/SC8F072-user-manual.pdf"
  schematic:
    - ""
  code:
    - ""

signals:
  - name: "PWM_OUTPUT_MAIN"
    pin: "RA0"
    direction: "output"
    default_state: "low"
    confirmed: false
    note: "SC8F072 的独立 10-bit PWM 输出组与 pin mux 强相关，需尽早固定输出脚。"
  - name: "ADC_INPUT_MAIN"
    pin: "AN1/RA1"
    direction: "input"
    default_state: "analog"
    confirmed: false
    note: "ADC 默认 12-bit；如切 10-bit，需要同步确认右对齐/左对齐解释口径。"
  - name: "COMPARATOR_SENSE"
    pin: "CMP0N/RA2"
    direction: "input"
    default_state: "analog"
    confirmed: false
    note: "比较器阈值依赖 RBIAS_H/RBIAS_L 与 LVDS 联合配置，不是单一寄存器位。"
  - name: "TIMER_CAPTURE_OR_EXTCLK"
    pin: "T0CKI"
    direction: "input"
    default_state: "pull-low"
    confirmed: false
    note: "若 TMR0 走外部时钟路径，需要同步确认 OPTION_REG.T0CS/T0SE/PSA。"

peripherals:
  - name: "tmr0"
    usage: "overflow timing with software reload"
  - name: "tmr2"
    usage: "periodic timing with PR2 and postscaler"
  - name: "pwm10"
    usage: "independent 10-bit PWM output"
  - name: "comp"
    usage: "comparator threshold and event detect"
  - name: "adc12"
    usage: "analog sampling and code-voltage conversion"

truths:
  - "SC8F072 具备 TMR0/TMR2、独立 10-bit PWM、comparator 和 12-bit ADC。"
  - "TMR0 无硬件自动重装载，当前时序应按中断中软件回写 TMR0 计算。"
  - "10-bit PWM 中 PWM0~PWM3 共用周期寄存器，PWM4 使用独立周期寄存器。"
  - "comparator-threshold 使用内部 VR 时，需要 RBIAS_H/RBIAS_L + LVDS 联合配置。"
  - "ADC 支持 VDD 与内部 LDO 参考源，换算口径必须绑定参考源。"

constraints:
  - "封装差异很大（SOT23-6/SOP8/MSOP10/SOP14/SOP16/QFN16），引脚表必须以实际封装为准。"
  - "TMR0 外部时钟/边沿模式与分频配置受 OPTION_REG 联动约束。"
  - "PWM 输出脚与 ADC/comparator 输入在部分封装上存在复用竞争。"
  - "ADC 采样通道、参考源与目标电压换算口径必须在项目内固定。"

unknowns:
  - "最终量产封装型号和可用引脚范围。"
  - "主时基走 TMR0 还是 TMR2。"
  - "PWM 实际输出通道与功率级映射关系。"
  - "ADC 参考源选择（VDD 或内部 LDO）。"
