goals:
  - "Complete the minimum functional closure for SC8F072 and confirm the four main paths: timer, PWM, comparator, and ADC."

features:
  - "Can output the target PWM frequency and duty cycle stably and fix the actual output pin."
  - "Can output a stable system tick or interrupt period (TMR0 or TMR2)."
  - "Can complete at least one comparator threshold decision path and provide the register configuration."
  - "Can close the loop between ADC code values and voltage conversion against a fixed reference-source."

constraints:
  - "TMR0 results must be evaluated using the software-reload model rather than treated as a hardware auto-reload timer."
  - "PWM0~PWM3 share the period register, so cross-channel adjustments must not break already working channels."
  - "Comparator threshold configuration must retain evidence for the RBIAS_H/RBIAS_L + LVDS combination."
  - "ADC conversion must use a fixed reference-source; mixed conventions are not allowed."

acceptance:
  - "Provide executable timer/pwm/comparator/adc tool results and write them into the project truth layer."
  - "Key pin-mux conflicts are identified and written into the hardware-logic document."
  - "At least one ADC voltage-conversion path matches bench results or expected values."

failure_policy:
  - "When timing error is abnormal, check clock source, prescaler, and reload model before changing application logic."
  - "When PWM waveform behavior is abnormal, check output-group selection and shared period registers before changing control algorithms."
  - "When ADC/comparator behavior does not match expectations, check reference sources and threshold conventions before calling it a hardware fault."

unknowns:
  - "The final system main-clock and low-power mode switching strategy."
  - "The final PWM channel allocation and power-stage requirements."
  - "Critical ADC sampling channels and sampling-window timing."

sources:
  - "docs/SC8F072-user-manual.pdf"
