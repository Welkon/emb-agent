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
    note: "TM2 PWM commonly uses PA3/PA4 as output pins, so the board-level mapping should be fixed early."
  - name: "COMPARATOR_POSITIVE"
    pin: "PA4/CIN+"
    direction: "input"
    default_state: "analog"
    confirmed: false
    note: "Comparator input is multiplexed with TM2PWM, so pin-mux conflicts are common during debugging."
  - name: "COMPARATOR_NEGATIVE"
    pin: "PA3/CIN-"
    direction: "input"
    default_state: "analog"
    confirmed: false
    note: "If PA3 is already used for PWM output, the comparator negative input should move to another CIN- candidate."
  - name: "PROGRAM_RESET_PIN"
    pin: "PA5/PRSTB"
    direction: "input"
    default_state: "reset"
    confirmed: false
    note: "PA5 doubles as programming/reset, so confirm before production whether reuse is allowed."

peripherals:
  - name: "timer16"
    usage: "periodic timing and timeout"
  - name: "tm2-pwm"
    usage: "PWM output and duty control"
  - name: "gpc"
    usage: "comparator threshold and state detect"

truths:
  - "PMS150G provides Timer16, TM2 PWM, and a comparator, but no ADC."
  - "The usable Timer16 interrupt bits are BIT8~BIT15."
  - "TM2 PWM output supports only PA3 and PA4."
  - "The comparator supports an internal reference and a 1.20V bandgap, but the bandgap is not suitable for comparator wake-up."
  - "ROM/RAM headroom is tight, so implementation should default to ROM-first constraints."

constraints:
  - "If the product depends on analog sampling, PMS150G should not be treated as a usable ADC platform."
  - "The PWM/comparator mux conflict on PA3/PA4 must be confirmed at the schematic stage."
  - "The reset/programming path on PA5/PRSTB cannot be postponed until late-stage rework."
  - "Code structure must stay lightweight to avoid ROM overruns from heavy abstraction."

unknowns:
  - "Whether the final output pin is PA3 or PA4."
  - "The comparator input-pin combination and threshold strategy."
  - "The reset / reuse strategy for PA5 in production hardware."
