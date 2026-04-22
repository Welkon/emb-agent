---
name: motor-drive
title: Motor Drive
summary: Motor power-stage, current-sense timing, startup behavior, and fault-protection checks.
auto_inject: true
selectable: true
priority: 62
apply_when.specs: [motor-drive]
focus_areas: [power_stage, pwm_generation, current_sense, startup_sequence, fault_protection, control_loop]
extra_review_axes: [deadtime_and_shoot_through, sampling_window_alignment, fault_shutdown_path, startup_and_stall_behavior, sensor_feedback_consistency, control_loop_latency]
preferred_notes: [docs/MOTOR-CONTROL.md, docs/POWER-STAGE.md, docs/DEBUG-NOTES.md]
---
# Motor Drive

- Review motor power-stage behavior, PWM timing, startup, and fault protection.
