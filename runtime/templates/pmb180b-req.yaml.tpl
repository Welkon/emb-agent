goals:
  - "Complete the minimum runnable board-level closure for PMB180B and confirm the charging, undervoltage, and output paths."

features:
  - "Can recognize an external 5V charging input and reliably distinguish no input / abnormal input / normal input."
  - "Can determine charging, termination, and full-charge states according to project policy."
  - "Can output the target PWM or LPWMG waveform and record the final pin and peripheral block used."
  - "Can provide stable degraded behavior or shutdown under undervoltage conditions."

constraints:
  - "5V presence detection must use CHG_TEMP.4 && CHG_TEMP.3 instead of a single bit."
  - "If PMB180B CHG_TEMP.1 is used for charge-complete detection, interpret it from bench results as high = charging and low = full."
  - "LVDC / comparator internal detection during charging may read about 0.15V higher than actual battery voltage."
  - "The package, output pin, and pin-mux allocation must be fixed early in the project."

acceptance:
  - "Can state the current charging-input, charge-complete, and undervoltage-handling rules explicitly."
  - "The target frequency, duty cycle, and output pin for PWM or LPWMG output are confirmed by bench results or code configuration."
  - "Key pitfalls are written back into hw.yaml / docs instead of living only in conversation."

failure_policy:
  - "When CHG_TEMP / V400_FG / LVDC semantics disagree, prefer bench observations and verified register reads."
  - "Do not move into broad code implementation while pin mux, package, or output blocks remain unconfirmed."
  - "If documentation conflicts with bench results, record the conflict in DEBUG-NOTES and HARDWARE-LOGIC before deciding implementation."

unknowns:
  - "Whether final output uses TM2 PWM or LPWMG."
  - "The minimum full-charge duration required by the actual battery capacity."
  - "Whether the production version needs extra undervoltage protection, current protection, or shutdown policy."

sources:
  - "docs/PMB180B-datasheet.pdf"
