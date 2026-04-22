---
name: battery-charger
title: Battery Charger
summary: Charge-state transitions, thresholds, protection margins, and wake/power fallback checks.
auto_inject: true
selectable: true
priority: 60
apply_when.specs: [battery-charger]
focus_areas: [charge_input_detection, full_charge_logic, low_voltage_margin, pwm_output_path, wakeup_sources]
extra_review_axes: [charge_state_machine, threshold_margin, pin_mux_conflicts, power_fallback]
preferred_notes: [docs/POWER-CHARGING.md, docs/HARDWARE-LOGIC.md, docs/DEBUG-NOTES.md]
---
# Battery Charger

- Review charge-state transitions, thresholds, protection margins, and wake paths.
