---
name: embedded-space
title: Embedded Space
summary: Generic MCU firmware rules: hardware truth, explicit ownership, bounded timing, thin ISR design, safe state, and measured verification.
selectable: false
priority: 58
enforcement_scope: code-writing
focus_areas: [hardware_truth, state_ownership, isr_shared_state, time_base, c_interface_boundaries, board_binding, verification]
extra_review_axes: [register_truth, atomic_shared_state, timebase_jitter, state_ownership, hardware_leakage, integration_boundaries]
---

# Embedded Space

Use this spec for vendor-neutral MCU firmware. It defines general embedded rules that apply across 8-bit, 16-bit, and 32-bit MCU projects.

Pair it with vendor, chip-family, or project-local specs for compiler dialects, IDE behavior, memory budgets, package pinout, peripheral formulas, and board-specific constraints.

## Scope And Layering

- **Specs are coding constraints only.** Put design decisions, rationale, interview conclusions, domain knowledge, and "why we chose X over Y" in `.emb-agent/wiki/decisions/`, not in spec files. Specs answer "what rule must code follow"; wiki answers "why that rule exists."
- Keep this spec vendor-neutral and MCU-family-neutral.
- Do not add compiler dialect, IDE project-file, SFR header, absolute-address syntax, package pinout, memory-size threshold, vendor library, or chip-specific peripheral rules here.
- Put vendor/toolchain rules in selectable vendor specs such as `scmcu-space` or `padauk-space`.
- Put concrete chip/package/board facts in project truth (`hw.yaml`, `req.yaml`) or project-local specs.
- For each touched physical signal, project truth should record pin, direction, default state, `active_level`, electrical drive type, pull/bias, power domain, startup/fault `safe_state`, sleep state, wake source, and analog divider/reference details when relevant. Treat blank electrical or sleep/wake fields as unknown hardware truth, not as permission to infer behavior.
- When multiple specs apply, use this order: hardware truth and measured behavior first, then project-local/chip/vendor specs, then this generic embedded-space guidance.

## Core Stance

- Prioritize correct product behavior and hardware safety before code shape.
- Start design from real hardware ownership, timing, and failure modes, not abstract architecture vocabulary.
- Prefer simple, reviewable control flow when it satisfies the product requirement.
- Add abstraction only when it isolates real hardware variation, removes real duplication, protects a clear invariant, or improves verification.
- Treat register writes, power-state transitions, sleep entry, wake recovery, and output enable paths as safety-relevant operations.

## Hardware Truth And Ownership

- Confirm the exact MCU, package, board net, active level, and peripheral mux before changing hardware behavior.
- One module should own each physical output, peripheral, and shared hardware resource at a time.
- Application logic should consume semantic state and call hardware/platform APIs; it should not scatter board pin or register decisions across unrelated modules.
- Board/platform code may know concrete pins, channels, and registers. Generic application modules should not.
- Before enabling an output or changing a mux, define the reset/default state, fault state, and owner for every affected pin.
- For analog inputs, record the divider/reference/source impedance assumption and verify thresholds against measured or datasheet-backed values before changing protection, battery, or charging behavior.

## Time Base And Main Loop

- Use an explicit time base for debounce, filtering, display refresh, control loops, timeouts, and watchdog policy.
- Keep periodic work bounded. Each slice should have a stated cadence, owner, and worst-case expectation.
- Avoid blocking waits in the main loop unless the product timing and watchdog policy explicitly allow them.
- When multiple cadences are derived from one tick, keep dividers/counters direct and reviewable.
- Before relying on a time base, verify clock source, prescaler/reload settings, interrupt cadence, jitter tolerance, and sleep/wake interaction.
- For low-power work, maintain a wake/sleep matrix: entry conditions, enabled wake sources, peripherals shut down before sleep, GPIO/PWM/ADC/register state restored after wake, watchdog policy, wake latency target, and measured idle-current target.

## ISR And Shared State

- Keep ISR work minimal: identify the source, clear/latch the interrupt condition, update the minimum shared state, and return.
- Do not put debounce policy, long ADC conversions, display policy, control state machines, blocking waits, logging, or watchdog feeding in an ISR unless a project-specific rule explicitly justifies it.
- Mark ISR-shared variables with the project's required volatile/atomic mechanism.
- Protect multi-byte or non-atomic shared state when it is accessed from both ISR and main context.
- Define what happens when interrupts are disabled, missed, nested, or delayed.

## State, Faults, And Outputs

- Model unknown, fault, startup, and safe/off states explicitly.
- Unknown or invalid inputs should not silently map to an active output state.
- Output enable decisions should be centralized enough that safety review can find every path that can turn hardware on.
- On startup, before sleep, after wake, and on fault, drive or release pins into documented safe states.
- Separate input sampling/filtering from product action decisions when that improves reviewability.

## C Interfaces And Module Boundaries

- Headers should expose the smallest stable surface: public types, handles, constants, and function declarations needed by callers.
- Keep writable module state private where practical.
- A module split should reflect real ownership: hardware resource, timing domain, state owner, protocol boundary, or independently verified behavior.
- Do not split code only because a file is long, and do not merge distinct hardware owners only to reduce file count.
- If using handles, callbacks, ops tables, or registration, document the real variation they represent and how failures/null operations are handled.
- Application code should not call through internal dispatch fields directly; public wrappers own validation and dispatch.

## Boundary Validation

- Validate inputs once at the system edge: ADC samples, sensor readings, communication packets, external memory reads, user inputs, configuration bytes. After validation, trust internal invariants.
- Do not scatter defensive null-pointer, range, or validity checks across internal functions when the caller has already guaranteed the invariant through the validated entry path.
- When the same validation check appears three or more times across different internal call sites, redesign the boundary first — move validation to the entry point and narrow the internal interface to accept only trusted, valid data.
- Document the invariant that makes each internal check unnecessary (e.g., "caller guarantees `adc_reading` is in [0, 4095] after edge validation").
- This principle matters on resource-constrained MCUs: every redundant `if (ptr != NULL)`, range check, or error-return path costs flash, RAM, and cycles. Make each check pay for itself.
- Treat register writes, interrupt flags, and DMA buffer ownership the same way: validate the buffer descriptor or channel config once at setup, then trust the hardware contract during the transfer.

## Verification Discipline

- Verify with the toolchain, IDE, or build flow that will be used for the target artifact.
- Inspect compiler warnings, memory/resource usage, map/listing output where available, and generated artifacts relevant to startup and interrupts.
- For timing-sensitive work, verify tick cadence, ISR latency, sleep/wake recovery, and worst-case main-loop execution.
- For hardware outputs, verify reset behavior, enable/disable transitions, fault injection, and no unintended pulses.
- For sleep/low-power work, separate runtime safe states from sleep-current states. A display or bus may require high-Z while running, but the lowest sleep current may require deterministic input/output levels on non-wake pins.
- Treat vendor example code and measured board behavior as first-class evidence for low-power entry and wake sequencing. If a manual mnemonic and an official example differ, try the example path before inventing a register sequence.
- Always confirm whether the user flashes the command-line artifact, an IDE-built artifact, or a programmer configuration. Do not assume a local HEX includes configuration bits or is the artifact being burned.
- For board-facing behavior, record board revision, chip marking/package, programmer/IDE/toolchain version, firmware image hash, supply/load condition, measured waveform/current/threshold values, and evidence file path. PC logic tests do not prove PWM, ADC, output pulse, current, reset, wake, or sleep-current behavior.
- Record bench gaps and assumptions close to the task or project truth, not only in conversation. When the user confirms real-board pass/fail/current/wake behavior, preserve it as a board validation record before treating it as settled truth.

## Avoid Without Project-Specific Justification

- Hidden ownership of pins or peripherals.
- Unbounded blocking in main-loop firmware.
- ISR paths that perform product policy or long work.
- Enabling outputs from unknown, invalid, or partially initialized state.
- Hardware behavior inferred from chip family name instead of package/board truth.
- Toolchain-specific syntax or memory-placement rules in generic modules.
