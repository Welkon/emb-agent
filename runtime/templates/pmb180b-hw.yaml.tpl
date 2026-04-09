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
    note: "5V input detection cannot rely on CHG_TEMP.4 alone; it must satisfy CHG_TEMP.4 && CHG_TEMP.3."
  - name: "BATTERY_NODE"
    pin: "VBAT"
    direction: "input"
    default_state: "battery"
    confirmed: false
    note: "Under LVDC and charging conditions, internal detection is usually about 0.15V higher than actual battery voltage."
  - name: "PWM_OR_LPWM_OUTPUT"
    pin: "PA0"
    direction: "output"
    default_state: "low"
    confirmed: false
    note: "PA0 can be used as an LPWMG0 output candidate; if TM2 PWM is used, the common output pins are PA3/PA4."
  - name: "WAKE_OR_INT_INPUT"
    pin: "PA4"
    direction: "input"
    default_state: "pull-high"
    confirmed: false
    note: "PA4 may serve comparator/TM2PWM or INT1, so pin mux must be confirmed early."

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
  - "PMB180B includes Timer16, TM2 PWM, LPWMG0/1/2, a GPC comparator, LVDC, and a charger block."
  - "Based on bench results, PMB180B CHG_TEMP.1 should be interpreted as high = charging, low = charge complete; do not copy old material blindly."
  - "LPWMG0/1/2 share LPWMGCUBH/LPWMGCUBL period registers; the three channels cannot be treated as independent PWM blocks."
  - "LVDC does not support interrupts or wake-up; it can only be polled via status bits."
  - "The current manual does not show ADC resources, so treat the part as having no ADC by default."

constraints:
  - "The package must be fixed early as ESOP8 or ESSOP10 because the available IO and LPWMG/comparator input sets differ."
  - "If the project depends on charge-complete detection, explicitly choose the CHG_TEMP.1 rule, the V400_FG + duration rule, or both."
  - "When undervoltage or comparator thresholds are involved, reserve about 0.15V of internal detection offset during charging."
  - "PWM, LPWMG, comparator, and INT functions on PA0/PA3/PA4/PA5/PA6 compete for pin mux."

unknowns:
  - "Whether the final package is ESOP8 or ESSOP10."
  - "Whether output should use TM2 PWM or LPWMG."
  - "The target charging-current step and the actual battery capacity."
  - "The charge-complete rule and minimum duration used by the project."
