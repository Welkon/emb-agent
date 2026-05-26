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

Use this spec for vendor-neutral MCU firmware rules across 8-bit, 16-bit, and 32-bit bare-metal architectures.
Pair it with vendor and project specs for toolchain quirks, register layouts, and physical pinout maps.

- **Specs are coding constraints only.** Put architecture decisions and rationales in `.emb-agent/wiki/decisions/`. Specs enforce "what rule code must obey"; the wiki archives "why that rule rules."

## Core Stance

- **Safety Over Form:** Prioritize flawless hardware execution safety and deterministic power-on states above code aesthetics or software design patterns.
- **Physical Sovereignty First:** Build logic upwards from explicit register ownership, clock domains, and electrical failure vectors, never from abstract proxy layers.
- **Atomic Operations Trapping:** Treat peripheral register writes, sleep entries, wake routines, and power-rail switches as safety-critical entry points requiring isolated verification paths.

## Hardware Truth And Monolithic Ownership

- Verify the exact silicon footprint, pin mux mapping, and hardware electrical active-state level before emitting single-bit changes.
- **The Exclusive Owner Rule:** Exactly one firmware module must own a given physical IO pin, hardware peripheral, or shared register map channel. No parallel mutation allowed.
- Keep board configurations isolated to hardware platform interfaces. Application-layer modules must interact exclusively with semantic states, completely blind to underlying pin maps or port registers.

## Bounded Time Base And Main Loop Control

- Execute all software debouncing, current limits, control cadences, and watchdog timeouts via a unified, explicit hardware-driven time base.
- **Zero In-Loop Blocking:** Forbid arbitrary or unmeasured delay loops within the foreground execution path. Every main loop task slice must execute with an upfront bounded runtime limit.
- Validate timebase configurations (clock multipliers, divider reload matches, interrupt latencies) against physical execution loops before deploying timing logic.

## Thin ISR And Isolated Shared State

- **Naked Interruption Rule:** ISR logic must only execute absolute minimum hardware maintenance: identify source flags, clear/latch the interrupt condition, mutate the minimum atomic shared state state-vector, and exit immediately.
- Absolutely no logic state machines, analog-to-digital conversions, long loops, or display data loading within an ISR context.
- Enforce strict `volatile` compiler qualifiers or explicit atomic primitives on all variables shared across the interruption boundary. Protect non-atomic multi-byte memory states with explicit, narrow critical section locks.

## Explicit State & Fault Defenses

- Explicitly map unknown initialization vectors, fault events, and startup windows into dedicated, deterministic software safe states.
- Anomalous or noise-filtered input conditions must never trigger active, high-power output transitions. Centralize output-enable paths so a safety review can audit every mechanism capable of driving physical current.

## Edge Sovereignty (Boundary Validation Gate)

- **The Monolithic Gate:** Validate all raw inputs—such as ADC values, raw capacitive touch frequencies, packet buffers, or IO read samples—**exactly once at the system edge boundary**. Once inside the system gate, trust the established structural invariants completely.
- **Zero Downstream Defensive Bloat:** Eradicate all redundant internal validation checks (e.g., duplicated `if (ptr != NULL)`, out-of-range bounds checks, or repetitive safety cascades) inside inner module loops. Every internal check represents a flash, RAM, and clock-cycle deficit that a low-ROM MCU cannot tolerate.
- Shift the responsibility up: If an internal module requires verified inputs, enforce that invariant on the caller at the entrance boundary. Trust the data contract implicitly during core execution transfers.

## Verification Discipline

- Compulsory audit of compiler diagnostic warning tags, linker script memory maps, and listing allocation files after every compilation target.
- For low-power implementations, explicitly isolate runtime high-impedance states from sleep configuration vectors. Avoid assuming nominal register behavior; prioritize official vendor example flow logic for sleep entry and wake-up transitions.
- Never assume compiled output artifacts perfectly incorporate physical configuration bits or fuses. Validate the actual artifact map being flashed onto the physical bench board.

## Avoid Without Project-Specific Justification

- Hidden or distributed IO pin ownership matrix.
- Unbounded blocking instructions or busy-waits within the main foreground execution frame.
- ISR processing paths that handle high-level application policy or heavy arithmetic computations.
- Driving current or enabling output lines from uninitialized or speculative initial states.
- Toolchain-specific dialect macros injected into generic application-layer files.
