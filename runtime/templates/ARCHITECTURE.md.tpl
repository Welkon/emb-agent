# Architecture

> System architecture map — records the current state of the firmware, not future plans.
> Update after each feature acceptance. See `.emb-agent/reference/shared-conventions.md` for conventions.

## Official Firmware Framework

- Official mode: `event-step`
- Control contract: `sample-update-apply`
- Execution backend: project-selects-baremetal-or-rtos
- Step contract:
  1. service watchdog at the boundary required by the platform
  2. consume one ready event/tick window
  3. sample inputs once for that step
  4. run one top-level app step
  5. apply outputs
  6. decide idle/sleep and wake policy
- ISR contract: only capture hardware events, maintain fixed scan work, and publish minimal shared state for the next app step.
- Backend note: a bare-metal 1 ms tick loop is the default realization when it fits, but RTOS task/timer dispatch is allowed if it still preserves the same step contract and evidence-backed timing/power behavior.
- Legacy note: existing projects may keep older layouts until an explicit migration is approved; new work should converge to this contract.

## Module Map

<!-- List all modules with their responsibilities and boundaries -->

| Module | Responsibility | Owns (Peripherals) | Depends On |
|--------|---------------|---------------------|------------|
|        |               |                     |            |

## Data Flow

<!-- Describe key data flows between modules -->

```
[Sensor Input] → [Filter Module] → [State Machine] → [Actuator Output]
```

## Interrupt Routing

<!-- Document ISR assignments and priorities -->

| ISR | Vector | Priority | Handler Module | Shared State |
|-----|--------|----------|----------------|--------------|
|     |        |          |                |              |

## Peripheral Ownership

<!-- Mirror of hw.yaml peripheral ownership with rationale -->

| Peripheral | Instance | Owner Module | Rationale |
|------------|----------|-------------|-----------|
|            |          |             |           |

## Key Architecture Decisions

<!-- Record significant architecture decisions with rationale -->

| Decision | Date | Rationale | Alternatives Considered |
|----------|------|-----------|------------------------|
|          |      |           |                         |

## Subsystem Documents

<!-- Links to per-subsystem architecture docs -->
