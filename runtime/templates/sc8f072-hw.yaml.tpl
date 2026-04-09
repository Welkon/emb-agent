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
    note: "SC8F072 independent 10-bit PWM output groups are tightly coupled to pin mux, so output pins must be fixed early."
  - name: "ADC_INPUT_MAIN"
    pin: "AN1/RA1"
    direction: "input"
    default_state: "analog"
    confirmed: false
    note: "ADC defaults to 12-bit. If switched to 10-bit, confirm the right-aligned / left-aligned interpretation at the same time."
  - name: "COMPARATOR_SENSE"
    pin: "CMP0N/RA2"
    direction: "input"
    default_state: "analog"
    confirmed: false
    note: "Comparator thresholds depend on combined RBIAS_H/RBIAS_L and LVDS configuration, not on a single register bit."
  - name: "TIMER_CAPTURE_OR_EXTCLK"
    pin: "T0CKI"
    direction: "input"
    default_state: "pull-low"
    confirmed: false
    note: "If TMR0 uses an external clock path, confirm OPTION_REG.T0CS/T0SE/PSA together."

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
  - "SC8F072 provides TMR0/TMR2, independent 10-bit PWM, a comparator, and a 12-bit ADC."
  - "TMR0 has no hardware auto-reload, so current timing should be calculated using software reload inside the interrupt."
  - "In the 10-bit PWM block, PWM0~PWM3 share the period register while PWM4 uses an independent period register."
  - "When comparator-threshold uses internal VR, RBIAS_H/RBIAS_L + LVDS must be configured together."
  - "ADC supports VDD and internal LDO reference sources, and conversions must stay tied to the chosen reference source."

constraints:
  - "Package differences are large (SOT23-6/SOP8/MSOP10/SOP14/SOP16/QFN16), so the pin table must follow the actual package."
  - "TMR0 external-clock / edge modes and prescaler configuration are coupled by OPTION_REG constraints."
  - "PWM output pins and ADC/comparator inputs compete for muxing on some packages."
  - "ADC sampling channels, reference sources, and target-voltage conversion conventions must be fixed within the project."

unknowns:
  - "The final production package and usable pin range."
  - "Whether the main timing base uses TMR0 or TMR2."
  - "The mapping between actual PWM output channels and the power stage."
  - "ADC reference-source choice (VDD or internal LDO)."
