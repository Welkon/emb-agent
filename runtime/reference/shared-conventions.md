# emb-agent Shared Conventions

Shared conventions for emb-agent agents. Current project installs keep these conventions in `.emb-agent/workflow.md`; this runtime copy exists as package reference material.

---

## 0. Directory Structure

```
.emb-agent/
|-- .developer                Local developer identity used for agent context
|-- .language                 Preferred response language (`zh`, `en`, or blank)
|-- .template-hashes          Managed template fingerprints for repair/update
|-- .version                  Project template/runtime version
|-- config.yaml               Local emb-agent configuration and hook settings
|-- workflow.md               Human-readable workflow, layout, and conventions
|-- project.json              Package/profile metadata
|-- hw.yaml                   Hardware truth: MCU, pins, peripherals, clock, board facts
|-- req.yaml                  Product behavior, constraints, acceptance, unknowns
|-- attention.md              Agent boot-time required read
|-- ARCHITECTURE.md           Current module/peripheral/ISR ownership map
|-- tasks/                    Durable task records
|   `-- <task>/
|       |-- task.json
|       |-- prd.md            Optional task-local PRD fallback
|       |-- design.md         Optional durable design notes
|       |-- implement.md      Optional execution plan
|       |-- review.md         Optional review notes
|       |-- validation.md     Optional validation notes
|       `-- research/         Reusable task research from researcher/scouts
|           `-- <topic>.md
`-- .install/                 Installer logs, backups, version state, install result
```

Feature directories such as `cache/`, `graph/`, `wiki/`, `compound/`, `memory/`,
`sessions/`, `specs/`, `plugins/`, `issues/`, `audits/`, `roadmap/`, and
`refactors/` are created only when the matching command or installer option needs
them. Do not treat old `reference/`, `templates/`, `registry/`, or
`architecture/` directories as required project layout; current architecture truth
lives at `.emb-agent/ARCHITECTURE.md`.

## 0.1 Truth Placement Map

| Information | Primary location |
|---|---|
| Boot-time traps, active priorities, environment blockers | `.emb-agent/attention.md` |
| MCU/package/pins/peripherals/clock/board facts | `.emb-agent/hw.yaml` |
| Product behavior, constraints, acceptance, unknowns | `.emb-agent/req.yaml` and `docs/prd/` |
| Reusable task-specific research | `.emb-agent/tasks/<task>/research/<topic>.md` |
| Reusable traps/tricks/decisions/learnings/explorations | `.emb-agent/compound/` |
| Current module map, data flow, ISR routing, peripheral ownership | `.emb-agent/ARCHITECTURE.md` |
| Long-form source synthesis and human-readable notes | `.emb-agent/wiki/` |
| Machine query index | `.emb-agent/graph/` |
| Session-local continuity | `.emb-agent/memory/` and `.emb-agent/sessions/` |

If a fact fits two locations, write it to the primary truth file and link or summarize elsewhere. Do not leave durable hardware facts in chat only.

## 1. Naming Conventions

### Task slugs
- Lowercase letters, digits, hyphens only: `led-driver`, `uart-init`
- Max 40 characters
- Must be unique within the project

### Compound document slugs
- Lowercase, hyphens: `tm2-pwm-polarity`, `sdcc-opt-flags`
- Date prefix: `YYYY-MM-DD-{type}-{slug}.md`
- Type: `learn` | `trick` | `decision` | `trap` | `explore`

### Architecture document slugs
- Lowercase, hyphens: `timer-tm2`, `power-management`
- No date prefix (architecture is long-lived)

### Issue/Refactor/Audit slugs
- Same as task slugs
- Directory: `YYYY-MM-DD-{slug}/`

## 2. Superseding Rules

When a compound document is superseded by newer findings:
1. Set `status: superseded` in the old document's frontmatter
2. Add `superseded_by: YYYY-MM-DD-{type}-{new-slug}` field
3. Do NOT delete the old document — it serves as historical record

## 3. Commit Rules (Scoped Commit)

Each commit should be scoped to one logical change:
1. Code changes + related task/issue/refactor artifacts
2. Compound knowledge documents created during the work
3. Architecture document updates reflecting post-implementation state

Commit message format: `type(scope): description` following Conventional Commits.

## 4. Agent Boot Sequence

All agents MUST follow this boot sequence:
1. Read `.emb-agent/attention.md` — project constraints and known traps
2. Read `.emb-agent/HOST.json` — install metadata
3. If either is missing → prompt user to run initialization
4. Read `.emb-agent/workflow.md` — cross-agent conventions

## 5. Stage Gates

Between workflow stages, agents MUST stop and ask for user confirmation:
- Design → Implementation: user approves design doc
- Implementation → Acceptance: user confirms implementation complete
- Acceptance → Close: user confirms acceptance criteria met
- Knowledge capture: user confirms compound entries before writing
- Issue Report → Analyze: user confirms report accuracy (see bug-hunter Gate 1)
- Issue Analyze → Fix: user confirms root cause and fix approach (see bug-hunter Gate 2)
- Issue Fix → Close: user confirms fix verification (see bug-hunter Gate 3)

Recording threshold for compound entries: see the `Knowledge Evolution` section in `.emb-agent/workflow.md`.
Core rule: record only if repeatable AND (expensive OR not-visible-in-code).

## 6. Terminology Discipline

Before introducing a new term (function name, macro, type, variable):
1. Grep the project for potential conflicts
2. Check `.emb-agent/ARCHITECTURE.md` for existing terminology
3. Check `.emb-agent/compound/` for related decisions
4. If conflict found → rename or explicitly differentiate in docs

## 7. Hardware-First Ladder (The Embedded Ponytail)

Before writing ANY firmware code, stop at the first rung that holds:

1. **Does this need to exist at all?** Speculative feature = skip it. YAGNI applies to firmware too.
2. **MCU hardware peripheral does it?** Use hardware PWM instead of bit-banging. Hardware CRC instead of software CRC. Hardware I2C/SPI instead of software protocol. DMA instead of CPU copy loops.
3. **Vendor HAL/SDK covers it?** Use `HAL_UART_Transmit()` before writing register-level UART code.
4. **Chip ROM bootloader or built-in routine?** Check if the MCU already has it in ROM.
5. **Existing project code already solves it?** Reuse. Don't rewrite.
6. **Can it be a single register write or one-liner?** One line. No wrapper, no abstraction.
7. **Only then:** the minimum firmware implementation that works.

Climb fast. Two rungs work → take the higher one. Don't research all seven.

### Ladder Marking Convention

Every deliberate simplification MUST carry a `ponytail:` comment naming the ceiling and upgrade path:

```c
// ponytail: busy-wait polling, switch to DMA+IRQ if CPU load >5%
while (!(USART1->SR & USART_SR_TXE));

// ponytail: fixed prescaler 8399 for 1kHz, make configurable via #define when multiple PWM freqs needed
TIM1->PSC = 8399;

// ponytail: global lock, per-peripheral locks if contention measured
__disable_irq();
```

Three rules:
- Every shortcut marked, never silently accepted.
- Comment names the ceiling (what the "proper" implementation would be).
- Comment names the trigger (when to upgrade: "if CPU load >5%", "when multiple freqs needed").

### Never Ladder Away

These are NEVER simplified: input validation at hardware boundaries (ADC ranges, pin voltage levels), error handling that prevents data loss (flash write verification, EEPROM wear leveling), safety interlocks (watchdog, brown-out, over-current), anything explicitly required by the datasheet or schematic.
