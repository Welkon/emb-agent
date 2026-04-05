mcu:
  vendor: ""
  model: "{{MCU_NAME}}"
  package: ""

board:
  name: "{{BOARD_NAME}}"
  target: "{{TARGET_NAME}}"

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
    confirmed: false
    note: "{{NOTE_1}}"
  - name: "{{SIGNAL_2}}"
    pin: "{{PIN_2}}"
    direction: "{{DIR_2}}"
    default_state: "{{STATE_2}}"
    confirmed: false
    note: "{{NOTE_2}}"

peripherals:
  - name: ""
    usage: ""

truths:
  - ""

constraints:
  - ""

unknowns:
  - ""
