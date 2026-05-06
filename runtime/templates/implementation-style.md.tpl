# {{PROJECT_NAME}} Embedded Implementation Style

> Goal: keep firmware decisions reviewable by tying register behavior, formulas, and magic numbers back to real source material.
> Last updated: {{DATE}}

## 1. Source Rules

- Primary MCU manual:
- Datasheet:
- Peripheral manuals / module datasheets:
- Official examples or reference code:

## 2. Comment Rules

- Register sequences with non-obvious bits or ordering must cite the manual section or table.
- Formula-driven code must cite the formula source or show the derivation.
- Magic numbers that encode timing, thresholds, scaling, or protocol windows must name the source.
- A register init block may use one shared source comment when all lines come from the same section.
- Engineering choices must be labeled as decisions, not disguised as manual facts.

## 3. Good Patterns

```c
// Ref: Timer2 chapter, PWM mode and reload sequence.
// Duty and period come from the vendor formula Fpwm = Fsys / (prescaler * period).
T2CON = 0x12;
T2PR = period_reload;
T2DC = duty_reload;
```

```c
// Engineering choice: debounce widened from the manual minimum to tolerate sensor noise on this board.
const uint16_t debounce_ms = 24;
```

## 4. Review Checklist

- [ ] All non-obvious register writes have a nearby source note
- [ ] All formulas and magic numbers have source or derivation
- [ ] Unverified assumptions are marked as unknown or TODO
- [ ] Comments distinguish manual facts from engineering choices

## 5. Project-Specific Exceptions

-
