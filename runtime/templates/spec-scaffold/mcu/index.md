# MCU-Level Hardware Constraints

> Index of MCU-level constraints. Scaffolded by emb-agent init.

## Guidelines Index

| File | Description | Status |
|---|---|---|
| [rom-ram-budget.md](./rom-ram-budget.md) | Program and data memory limits | active |
| [clock-tree.md](./clock-tree.md) | Clock source selection and divider rules | active |
| [peripheral-conflicts.md](./peripheral-conflicts.md) | IO mux, DMA, interrupt vector conflicts | active |

## Pre-Development Checklist

- All tasks → [rom-ram-budget.md](./rom-ram-budget.md)
- Timer/PWM/clock changes → [clock-tree.md](./clock-tree.md)
- New peripheral or IO pin usage → [peripheral-conflicts.md](./peripheral-conflicts.md)

## Quality Check

- [ ] ROM/RAM usage within budget (check map file)
- [ ] No peripheral conflicts with existing HW config
- [ ] All clock configurations reference valid chip profile sources
