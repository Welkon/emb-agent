# Motor Drive Focus

- Re-check PWM generation, deadtime, polarity, brake behavior, and fault shutdown as one path. A motor-control change is not closed if the protection path was not reviewed together.
- Keep current-sense timing aligned with the real switching window. If ADC trigger points, blanking time, or control-loop cadence change, verify what the control law actually sees.
- Make startup, stall, reverse, stop, and fault-recovery states explicit. "Motor running" should come from observable evidence, not from a single command or duty update.
- Verification should mention both performance and safety boundaries: low-speed behavior, over-current or over-temperature response, supply sag, sensor loss, and recovery after a latched fault.
