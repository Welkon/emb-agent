# Embedded Implementation Style

- When register writes depend on manual-defined mode bits, reload order, write-1-to-clear behavior, or multi-register composition, add a nearby source note that names the manual section, table, or datasheet anchor.
- When formulas or magic numbers appear in code, record the source or derivation in a short comment. This includes timing windows, PWM/baud/ADC calculations, thresholds, calibration constants, and protocol delays.
- A grouped initialization block may use one concise block comment for the shared source. Do not force a chapter citation onto every single register line when the whole block comes from the same section.
- Separate explicit manual facts from engineering decisions. If a value is chosen as a policy or tradeoff rather than copied from the manual, say so.
- If a register setting, formula bound, or electrical limit is still unverified, mark the source gap explicitly instead of presenting the code as manual-backed.

