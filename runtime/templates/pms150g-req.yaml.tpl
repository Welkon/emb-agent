goals:
  - "Complete the minimum control-loop closure for PMS150G and confirm Timer16, TM2 PWM, and comparator paths."

features:
  - "Can output a stable PWM waveform and fix the output pin."
  - "Can produce a reproducible Timer16 period configuration."
  - "Can provide comparator threshold configuration and confirm input-source mapping."

constraints:
  - "PMS150G does not support ADC, so any sampling requirement must move to an external solution or a different chip."
  - "TM2 PWM output supports only PA3/PA4, and comparator-input mux conflicts must be avoided early."
  - "The bandgap is not used for comparator wake-up paths."
  - "Under OTP + small RAM constraints, code paths must prioritize simplicity and control."

acceptance:
  - "The timer / pwm / comparator tool chains can directly provide executable configuration candidates."
  - "At least one board-level output path and one comparator decision path are confirmed."
  - "The no-ADC boundary is explicitly written into the project truth layer and design docs."

failure_policy:
  - "When timing anomalies appear, check the Timer16 clock source / prescaler / interrupt bits before changing application logic."
  - "When waveform anomalies appear, check TM2 output-pin mapping and the period register before changing control parameters."
  - "When comparator anomalies appear, check the input source and reference level before changing the state machine."

unknowns:
  - "The final mapping between PWM output pin and load topology."
  - "Whether the comparator participates in wake-up or is only polled."
  - "Whether later features require migration to a part with ADC support."

sources:
  - "docs/PMS150G-datasheet.pdf"
