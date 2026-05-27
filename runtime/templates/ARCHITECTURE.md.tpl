# Architecture

> System architecture map — records the current state of the firmware, not future plans.
> Update after each feature acceptance. See `.emb-agent/reference/shared-conventions.md` for conventions.

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
