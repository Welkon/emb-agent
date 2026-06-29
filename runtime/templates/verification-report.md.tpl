# {{PROJECT_NAME}} Verification

## Scope

- Date: {{DATE}}
- Profile: {{PROFILE}}
- Packs: {{PACKS}}
- Verification target:
- Board revision:
- Chip marking/package:
- Programmer / IDE / toolchain version:
- Firmware image path:
- Firmware image hash:
- Supply voltage / load condition:

## Checklist

- Power-up / reset / main entry
- Critical registers / pins / timing
- Failure paths / boundary conditions
- Config bits / fuses / clock / watchdog
- ROM/RAM/map/listing delta reviewed
- ISR/shared-state review complete
- Sleep/wake matrix reviewed when low-power behavior is in scope
- Board-level acceptance criteria measured when behavior touches hardware

## Results

- PASS:
- FAIL:
- WARN:
- UNTESTED:

## Evidence

- Manual / summary:
- Build / resource report:
- Map / listing review:
- Bench / simulation:
- Board measurement:
- Scope / logic analyzer capture:
- Current measurement:
- Code / commit:

## Measurements

| Item | Expected | Measured | Evidence path | Result |
|---|---:|---:|---|---|
| PWM frequency / duty / jitter |  |  |  | UNTESTED |
| ADC threshold / divider check |  |  |  | UNTESTED |
| Sleep current / wake latency |  |  |  | UNTESTED |
| Output safe state on reset/sleep/fault |  |  |  | UNTESTED |

## Resource Review

- Program ROM used / budget / delta:
- Data RAM used / budget / delta:
- New large symbols / tables:
- New printf/sprintf/float/division/large string usage:
- ISR or hot-loop growth:

## Follow-up

- Follow-up action 1:
- Follow-up action 2:
