mcu:
  vendor: "Padauk"
  model: "PMB180B"
  package: "esop8"

board:
  name: "{{BOARD_NAME}}"
  target: "{{TARGET_NAME}}"

sources:
  datasheet:
    - "docs/PMB180B-datasheet.pdf"
  schematic:
    - ""
  code:
    - ""

signals:
  - name: "CHARGER_INPUT_5V"
    pin: "VCC5"
    direction: "input"
    default_state: "unknown"
    confirmed: false
    note: "5V 输入判定不能只看 CHG_TEMP.4，必须同时满足 CHG_TEMP.4 && CHG_TEMP.3。"
  - name: "BATTERY_NODE"
    pin: "VBAT"
    direction: "input"
    default_state: "battery"
    confirmed: false
    note: "LVDC 与充电状态下内部检测通常比实际电池电压高约 0.15V。"
  - name: "PWM_OR_LPWM_OUTPUT"
    pin: "PA0"
    direction: "output"
    default_state: "low"
    confirmed: false
    note: "PA0 可作为 LPWMG0 输出候选；若走 TM2 PWM 则常见输出脚为 PA3/PA4。"
  - name: "WAKE_OR_INT_INPUT"
    pin: "PA4"
    direction: "input"
    default_state: "pull-high"
    confirmed: false
    note: "PA4 既可能承担 comparator/TM2PWM，也可能承担 INT1，需尽早确认 pin mux。"

peripherals:
  - name: "timer16"
    usage: "tick / timeout / wake sequencing"
  - name: "tm2-pwm"
    usage: "PWM output on PA3 or PA4"
  - name: "lpwmg"
    usage: "shared low-frequency PWM output"
  - name: "lvdc"
    usage: "battery threshold polling"
  - name: "charger"
    usage: "charge current selection and charge-state decode"
  - name: "gpc"
    usage: "comparator threshold and wakeup path"

truths:
  - "PMB180B 带 Timer16、TM2 PWM、LPWMG0/1/2、GPC comparator、LVDC 和 charger block。"
  - "PMB180B 的 CHG_TEMP.1 按实测应解释为：高=充电中，低=充电完成；不要照抄旧资料。"
  - "LPWMG0/1/2 共享 LPWMGCUBH/LPWMGCUBL 周期寄存器，不能把三个通道当成独立 PWM block。"
  - "LVDC 不支持中断和唤醒，只能轮询状态位。"
  - "当前手册未体现 ADC 资源，默认按无 ADC 处理。"

constraints:
  - "封装必须尽早确认 ESOP8 还是 ESSOP10，因为可用 IO 与 LPWMG/comparator 输入集合不同。"
  - "如果项目依赖充满判断，必须明确采用 CHG_TEMP.1 规则、V400_FG+持续时间规则，或两者并用。"
  - "涉及欠压阈值或比较器阈值时，充电状态下要预留约 0.15V 的内部检测偏移。"
  - "PA0/PA3/PA4/PA5/PA6 上的 PWM、LPWMG、比较器、INT 功能存在 pin mux 竞争。"

unknowns:
  - "最终封装版本是否为 ESOP8 或 ESSOP10。"
  - "输出应该走 TM2 PWM 还是 LPWMG。"
  - "充电电流目标档位与实际电池容量。"
  - "项目采用的充满判定规则和持续时间下限。"
