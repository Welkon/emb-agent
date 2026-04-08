mcu:
  vendor: "Padauk"
  model: "PMS150G"
  package: "sop8"

board:
  name: "{{BOARD_NAME}}"
  target: "{{TARGET_NAME}}"

sources:
  datasheet:
    - "docs/PMS150G-datasheet.pdf"
  schematic:
    - ""
  code:
    - ""

signals:
  - name: "PWM_OUTPUT_MAIN"
    pin: "PA3"
    direction: "output"
    default_state: "low"
    confirmed: false
    note: "TM2 PWM 常用输出脚为 PA3/PA4，需先定死板级映射。"
  - name: "COMPARATOR_POSITIVE"
    pin: "PA4/CIN+"
    direction: "input"
    default_state: "analog"
    confirmed: false
    note: "比较器输入与 TM2PWM 复用，调试期容易出现 pin mux 互斥。"
  - name: "COMPARATOR_NEGATIVE"
    pin: "PA3/CIN-"
    direction: "input"
    default_state: "analog"
    confirmed: false
    note: "如 PA3 已用于 PWM 输出，比较器负端应改走其他 CIN- 候选。"
  - name: "PROGRAM_RESET_PIN"
    pin: "PA5/PRSTB"
    direction: "input"
    default_state: "reset"
    confirmed: false
    note: "PA5 兼编程/复位语义，量产前必须确认是否允许复用。"

peripherals:
  - name: "timer16"
    usage: "periodic timing and timeout"
  - name: "tm2-pwm"
    usage: "PWM output and duty control"
  - name: "gpc"
    usage: "comparator threshold and state detect"

truths:
  - "PMS150G 具备 Timer16、TM2 PWM 与 comparator，不提供 ADC。"
  - "Timer16 中断位可用范围为 BIT8~BIT15。"
  - "TM2 PWM 输出脚仅支持 PA3 和 PA4。"
  - "比较器支持内部参考与 1.20V bandgap，但 bandgap 不适用于 comparator 唤醒。"
  - "ROM/RAM 边界紧，默认按 ROM-first 约束进行实现。"

constraints:
  - "若产品依赖模拟采样，不应把 PMS150G 当作可用 ADC 平台。"
  - "PA3/PA4 的 PWM 与 comparator 复用冲突必须在原理图阶段确认。"
  - "PA5/PRSTB 的复位/编程路径不能在后期才补救。"
  - "代码结构需要保持轻量，避免重抽象带来的 ROM 超额风险。"

unknowns:
  - "最终输出脚选择 PA3 还是 PA4。"
  - "比较器输入脚组合与阈值策略。"
  - "PA5 在量产硬件中的复位/复用策略。"
