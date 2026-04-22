---
name: padauk-firmware
title: Padauk Firmware
summary: Padauk / Simple-C syntax limits, constrained-toolchain tradeoffs, and ISR-to-main-loop discipline.
auto_inject: true
selectable: true
priority: 63
apply_when.specs: [padauk-firmware]
focus_areas: [constrained_c_toolchain, rom_budget, isr_shared_state, sleep_wakeup, register_level_io]
extra_review_axes: [compiler_syntax_limits, map_file_budget, atomic_shared_state, wakeup_reentry, naming_case_insensitivity]
preferred_notes: [docs/IMPLEMENTATION-STYLE.md, docs/HARDWARE-LOGIC.md, docs/DEBUG-NOTES.md]
---
# Padauk Firmware

- Review Simple-C limits, constrained toolchains, and ISR-to-main-loop discipline.
