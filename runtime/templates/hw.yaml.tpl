mcu:
  vendor: ""
  model: "{{MCU_NAME}}"
  package: ""

board:
  name: "{{BOARD_NAME}}"
  target: "{{TARGET_NAME}}"

design_notes:
  - "Hardware may include expansion headroom (e.g. extra channels, battery management). Current system scope is defined in docs/prd/system.md and structured firmware scope is mirrored in req.yaml."
  - "hw.yaml captures full hardware capability; docs/prd/system.md and req.yaml capture current implementation intent. Differences are not necessarily conflicts."

sources:
  datasheet:
    - ""
  schematic:
    - ""
  code:
    - ""

signals:
  - name: "{{SIGNAL_1}}"
    pin: "{{PIN_1}}"
    direction: "{{DIR_1}}"
    default_state: "{{STATE_1}}"
    active_level: ""        # active_high | active_low | edge | analog | n/a
    electrical: ""          # push_pull | open_drain | input_only | analog | high_z
    pull: ""                # none | pullup | pulldown | external_pullup | external_pulldown
    power_domain: ""        # vdd | battery | usb | switched | always_on
    safe_state: ""          # startup/fault-safe state before product logic runs
    sleep_state: ""         # sleep/stop state: high_z | low | high | pullup | pulldown | unchanged
    wake_source: ""         # none | key | usb | comparator | timer | reset | wdt
    analog_role: ""         # adc_divider | comparator_input | reference | n/a
    divider: ""             # e.g. Rtop=200k,Rbot=100k,Vref=Vdd
    confirmed: false
    note: "{{NOTE_1}}"
  - name: "{{SIGNAL_2}}"
    pin: "{{PIN_2}}"
    direction: "{{DIR_2}}"
    default_state: "{{STATE_2}}"
    active_level: ""
    electrical: ""
    pull: ""
    power_domain: ""
    safe_state: ""
    sleep_state: ""
    wake_source: ""
    analog_role: ""
    divider: ""
    confirmed: false
    note: "{{NOTE_2}}"

peripherals:
  - name: ""
    usage: ""

resource_budget:
  program_rom_bytes: ""
  data_ram_bytes: ""
  rom_warn_percent: 80
  ram_warn_percent: 75
  required_rom_reserve_bytes: ""
  required_ram_reserve_bytes: ""

power_modes:
  run:
    clock: ""
    watchdog: ""
  sleep:
    entry_conditions: []
    wake_sources: []
    shutdown_before_sleep: []
    restore_after_wake: []
    idle_current_target: ""

config_bits:
  oscillator: ""
  watchdog: ""
  brown_out_reset: ""
  reset_pin: ""
  low_voltage_programming: ""
  code_protection: ""

truths:
  - ""

constraints:
  - ""

unknowns:
  - ""
