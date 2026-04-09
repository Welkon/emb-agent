# {{PROJECT_NAME}} MCU Foundation Checklist

> Goal: turn “it seems to run” into a maintainable implementation backed by manual-grounded truth at minimal cost.
> Principle: manuals first, tools second, implementation third (manual-first).
> Last updated: {{DATE}}

## 0. Source Entry Points

- MCU User Manual:
- Datasheet (electrical characteristics):
- Package / pin table:
- Reference design or official examples:
- Have current conclusions been written into `.emb-agent/hw.yaml` / `.emb-agent/req.yaml`?

## 1. CPU

- [ ] Architecture / word width confirmed (8-bit / 32-bit, ISA family)
- [ ] Interrupt entry and calling constraints confirmed (ISR limits, stack-usage risk)
- [ ] Compute budget boundaries confirmed (whether critical paths exceed budget)
- [ ] Key registers relevant to the current implementation are located in the manual

Key facts (write conclusions, not guesses):

- 

## 2. Clock

- [ ] Primary clock source confirmed (internal RC / external crystal)
- [ ] Clock division chain confirmed (system clock / peripheral clock)
- [ ] Time bases for key peripherals confirmed (Timer/PWM/UART/I2C, etc.)
- [ ] Timing constraints confirmed (min/max periods, jitter tolerance)

Key facts:

- 

## 3. Memory

- [ ] Flash/RAM budget confirmed
- [ ] Interrupt stack and main-loop/task stack budgets confirmed
- [ ] Persistence and upgrade space confirmed (if needed)
- [ ] Boundary strategy confirmed (overflow, fragmentation, failure fallback)

Key facts:

- 

## 4. Pins

- [ ] Power / reset / debug pins confirmed
- [ ] Application signal pin mapping confirmed and written into `hw.yaml`
- [ ] Pin-mux conflicts checked (debug / clock / peripheral pins)
- [ ] Voltage domains and pull-up/pull-down strategy confirmed

Key facts:

- 

## 5. Interrupts

- [ ] Interrupt sources listed completely (external / timer / communication / comparator, etc.)
- [ ] Priority strategy confirmed (who can preempt whom)
- [ ] ISR keeps only minimal actions; heavy work is delegated
- [ ] Shared-state protection between main loop/tasks and ISR confirmed

Key facts:

- 

## 6. Next Steps (Execution Order)

1. Write the key facts above into `.emb-agent/hw.yaml` / `.emb-agent/req.yaml`
2. Run `tool run ...` first for items that can be calculated
3. For missing references, use `ingest doc -> doc diff/apply` first
4. Then move on to implementation, debugging, and verification
