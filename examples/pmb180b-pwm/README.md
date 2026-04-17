# PMB180B PWM Bring-up

This example shows a concrete `emb-agent` bring-up flow for `PMB180B` when the target is a `20kHz`, `50%` PWM output on `PA3`.

It also captures an important device-specific outcome:

- `TM2 PWM` can drive `PA3`, but at `SYSCLK = 16MHz` it only gets close to `20kHz`
- `LPWMG2` can drive `PA3` and can hit `20kHz / 50%` exactly

## Scenario

Known hardware facts:

- MCU: `PMB180B`
- package: `ESOP8`
- output pin: `PA3`
- target: `20kHz`, `50% duty`
- clock: `SYSCLK = 16MHz`

This is the path when the MCU and output pin are already known and you want an executable register-level answer quickly.

## Command flow

```bash
emb-agent --json start

emb-agent --json declare hardware \
  --confirm \
  --mcu PMB180B \
  --package esop8 \
  --signal PWM_OUT \
  --pin PA3 \
  --dir output \
  --note "PA3 PWM demo" \
  --confirmed true \
  --peripheral PWM \
  --usage "20kHz 50% output demo"

emb-agent --json support source add local-pack \
  --type path \
  --location /path/to/emb-agent-adapters

emb-agent --json support sync local-pack --confirm

emb-agent --json task add \
  --confirm \
  "Bring up PMB180B PWM on PA3 at 20kHz 50% duty" \
  --type implement \
  --scope pwm \
  --priority P1

emb-agent --json task activate bring-up-pmb180b-pwm-on-pa3-at-20khz-50-duty --confirm
```

## TM2 path

Run `pwm-calc` for the built-in `Timer2 PWM` route:

```bash
emb-agent --json tool run pwm-calc \
  --family padauk-pmb180 \
  --device pmb180b \
  --chip pmb180b \
  --clock-source SYSCLK \
  --clock-hz 16000000 \
  --output-pin PA3 \
  --target-hz 20000 \
  --target-duty 50
```

Observed best candidate:

- actual frequency: `19230.769231 Hz`
- actual duty: `50%`
- frequency error: `-3.846154%`
- duty error: `0%`

Register hints:

```c
TM2CT = 0;
TM2B = 31;        // 0x1F
$ TM2S 7BIT,/1,/13;
$ TM2C SYSCLK,PA3,PWM;
```

Use this path when the goal is a fast, simple PWM bring-up and frequency error is acceptable.

## LPWMG2 path

Run `lpwmg-calc` for the `LPWMG2 -> PA3` path:

```bash
emb-agent --json tool run lpwmg-calc \
  --family padauk-pmb180 \
  --device pmb180b \
  --chip pmb180b \
  --channel LPWMG2 \
  --output-pin PA3 \
  --clock-source SYSCLK \
  --clock-hz 16000000 \
  --target-hz 20000 \
  --target-duty 50
```

Observed best candidate:

- actual frequency: `20000 Hz`
- actual duty: `50%`
- frequency error: `0%`
- duty error: `0%`

Register hints:

```c
$ LPWMGCLK Enable,/1,SYSCLK;
LPWMGCUBL = 0xC0;
LPWMGCUBH = 0xC7;
$ LPWMG2C LPWMG2,PA3;
LPWMG2DTL = 0xE0;
LPWMG2DTH = 0x63;
```

Use this path when the `20kHz / 50%` target must be met exactly on `PA3`.

## Takeaway

For `PMB180B`, `TM2 PWM` and `LPWMG` are not interchangeable:

- `TM2 PWM` is the simpler default path and supports `PA3` / `PA4`
- `LPWMG2` is the better fit when `PA3` must hit an exact `20kHz / 50%`
- `LPWMG0/1/2` share `LPWMGCUBH/LPWMGCUBL`, so shared-period constraints matter if multiple LPWMG channels are used together
