---
name: sensor-node
title: Sensor Node
summary: Sampling windows, settle time, calibration, and measurement-update path checks for sensor-node tasks.
auto_inject: true
selectable: true
priority: 60
apply_when.specs: [sensor-node]
focus_areas: [sampling, timing, calibration, low_power, signal_integrity]
extra_review_axes: [sampling_window, sensor_settle_time, debounce_or_filtering, measurement_update_path]
preferred_notes: [docs/HARDWARE-LOGIC.md, docs/DEBUG-NOTES.md]
---
# Sensor Node

- Review sampling windows, settle time, calibration, and measurement updates.
