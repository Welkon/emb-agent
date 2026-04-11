# Battery Charger Focus

- Re-check charge-state transitions, threshold margins, thermal or protection thresholds, and wake/fallback behavior together.
- Keep charger control logic aligned with measured truth paths, not just nominal thresholds from code comments.
- When PWM, comparator, or ADC parameters change, verify the downstream impact on charge detect and full-charge behavior.
- Record any remaining uncertainty around analog tolerances or board-level protection components before closing the task.

