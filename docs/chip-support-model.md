# Chip Support Model

emb-agent core stays abstract on purpose.

The core should own workflow, truth layers, state continuity, and tool contracts. Vendor-, family-, and chip-specific formulas should live in chip-support modules.

## What belongs in core

Core responsibilities:

- `start`, `declare hardware`, `next`, and the default embedded workflow
- project truth files such as `hw.yaml` and `req.yaml`
- task manifests and task-local context
- session continuity and pause/resume
- abstract tool/chip catalog contracts and extension-registry readers

Core should not pretend every embedded vendor stack shares the same build, flash, or debug implementation.

## Analysis artifact boundary

When chip support needs to be derived from datasheets, manuals, or schematics, emb-agent should not jump from raw documents straight into ready support.

Use a constrained middle layer instead:

- document ingest extracts text and staged facts
- an analysis artifact captures evidence-backed chip understanding
- `adapter derive` / `adapter generate` turn that artifact into draft adapters

This keeps AI useful without letting it freely write support as if it were already production truth.

## What belongs in chip support

Chip support should own:

- family/device/chip-specific formulas
- tool routes and algorithm implementations
- chip profiles and package-specific pin information
- vendor-specific derived constraints and binding rules
- draft bindings generated from structured analysis artifacts

Core must not ship concrete chip profiles. `chip list` and `chip show` read project/runtime extension registries produced by `support sync`, `support bootstrap`, or `adapter derive`; an empty result means no chip support has been installed or generated yet, not that core owns an empty chip database.

Examples:

- timer calculation logic for a vendor family
- PWM output pin constraints for one device line
- chip-specific peripheral availability

## Coverage strategy

emb-agent should not scale to STM32, nRF, GD32, PADAUK, PUYA, SCMCU, or other families by adding vendor branches to core.

The scalable unit is a binding, not a hard-coded chip. Core tool routes should stay generic and read structured binding parameters such as:

- timer registers: `period_register`, `period_max`, `prescalers`, `postscalers`, and reload/count offsets
- PWM registers: `period_registers`, `duty_registers`, `prescalers`, `period_bits`, and duty/count offsets
- comparator thresholds: source ranges plus table rows for selectable threshold bits
- evidence links: datasheet/manual sections, formula registries, and wiki pages

That lets different vendors map their own names onto the same tool contract:

- STM32 / GD32 timers can bind `PSC`, `ARR`, and `CCRn`
- Nordic timers can bind `PRESCALER`, `CC[n]`, and bit width limits
- PADAUK / SCMCU / PUYA 8-bit parts can bind `PR2`, `PWMT`, `PWMDx`, or vendor-specific threshold tables

When board truth and parsed manual evidence differ by variant, keep the board chip profile explicit and add `compatible_tool_devices` only as a draft bridge. For example, a `sc8p052sop8` board profile can route tools through a `sc8p052b` device binding while generated CLIs still show both `--device sc8p052b` and `--chip sc8p052sop8`.

When a family needs behavior that does not fit a generic route, add a family-specific route under chip support. Do not move that exception into emb-agent core until several families prove the abstraction is genuinely common.

## Register write bindings

Generic generated routes can also emit firmware-useful register write plans. A binding can add `register_writes` under the tool params:

```json
{
  "register_writes": {
    "period_value": [
      {
        "register": "ARR",
        "field": "ARR<31:0>",
        "value_key": "period_value",
        "source_lsb": 0,
        "width": 32,
        "target_lsb": 0
      }
    ]
  }
}
```

Each plan key names the calculated value being written, such as `period_value`, `duty_value`, `reload_value`, or `threshold_selection`. Each field entry maps one source value into one register field:

- `register`: destination register name
- `field`: human-readable field name
- `value_key`: key in the calculated candidate or selected table row
- `source_lsb`: first source bit to copy
- `width`: number of bits to copy
- `target_lsb`: destination bit position in the register
- `value_base`: optional base for string values, such as binary threshold codes

This is the core mechanism for broad chip coverage. STM32/GD32 can map timer results to `PSC`, `ARR`, and `CCRn`; Nordic can map compare values to `CC[n]`; small 8-bit parts can split one calculated value across low/high registers such as `PWMTL` and `PWMTH`. Core only slices fields from bindings; it does not need vendor-specific register-write branches.

The generated output includes structured register entries, direct C statement strings, and CMSIS/HAL-style macro strings. For every merged register write, `register_writes.registers[]` carries `register`, `mask`, `mask_hex`, `write_value`, `write_value_hex`, `fields`, `c_statement`, and `hal_statement`. The plan also exposes `register_writes.c_statements[]` and `register_writes.hal_statements[]` as flat firmware-oriented lists. The generated direct C preserves unrelated bits through a masked read-modify-write form:

```c
ARR = (ARR & ~0xFFFFFFFF) | 0x3FF;
CCR1 = (CCR1 & ~0x3FF) | 0x200;
```

For CMSIS/HAL-style code, the same plan emits `MODIFY_REG()` statements:

```c
MODIFY_REG(TIM3->ARR, 0xFFFFFFFF, 0x3FF);
MODIFY_REG(TIM3->CCR1, 0x3FF, 0x200);
```

This is intentionally a macro-level HAL bridge, not a full vendor driver call generator. Full HAL APIs such as `HAL_TIM_PWM_ConfigChannel()` or `__HAL_TIM_SET_COMPARE()` need semantic inputs that are outside a generic register write plan: handle names, channel constants, initialization order, clock enable state, preload behavior, and update-event timing.

The next layer should be AI-authored firmware snippets, not a hand-maintained template library. emb-agent should provide the generation contract:

- inputs: hardware truth, chip profile, binding evidence, register write plan, selected candidate, local SDK/HAL headers, current firmware style, worktree status, and neighboring ISR/clock/low-power/init-order code
- workflow: inspect local firmware first, author a project-local review artifact by default, and write it under `.emb-agent/firmware-snippets/` when source files are dirty or the integration is behavior-changing
- required output: code snippet, assumptions, required includes/handles/channels, source edit policy, behavior couplings, write ordering, safety notes, and residual review items
- gates: compile or static-check evidence when available, link back to the calculated register values, block source patches when dirty source files or unreviewed behavior couplings exist, and mark unverified snippets as draft
- constraints: do not invent handles/channels/macros/init order, do not add helper functions solely to wrap generated register writes, and do not use a hand-maintained snippet template library

That keeps the reusable core small. The AI writes the STM32/GD32/nRF/PADAUK/SCMCU/PUYA-specific code from the current project's evidence and SDK surface; emb-agent records the inputs, provenance, and verification status. Reusable examples can be promoted later, but they should not be the primary mechanism.

Generated register write plans carry this as `register_writes.firmware_snippet_request`:

```json
{
  "protocol": "emb-agent.firmware-snippet-request/1",
  "authoring": "ai-authored",
  "status": "draft-until-verified",
  "required_output": [
    "code_snippet",
    "assumptions",
    "required_symbols",
    "source_edit_policy",
    "behavior_couplings",
    "write_ordering",
    "safety_notes",
    "verification_evidence",
    "residual_risks"
  ]
}
```

The request can be materialized into a project-local review artifact with:

```bash
emb-agent tool run <tool> [options] --save-output
emb-agent snippet draft --from-tool-output <tool-output.json> --title <name> --confirm
```

This command writes under `.emb-agent/firmware-snippets/`, records dirty source status and behavior couplings, and leaves firmware sources unchanged. Applying the snippet to production code is a later integration step that must cover the affected ISR, clock, low-power, SDK/HAL, and initialization paths.

## Repository roles

emb-agent should treat chip support as a three-layer system:

1. core workflow
2. project-local draft support
3. shared reusable support catalog

In practice that means:

- `emb-agent` core owns workflow, truth, routing, analysis artifacts, and derivation contracts
- the current project can hold draft support that is only good enough for this repository
- a separate chip-support / adapters repository should only hold support that is ready to be reused across projects

This is why a separate adapters repository still makes sense, but it should no longer be the default user entrypoint.

For most users, the intended path is:

```text
project truth -> analysis artifact -> project-local draft support -> review -> shared reusable support
```

The shared catalog exists for publication and reuse, not as a prerequisite before normal project work can begin.

## Why this split matters

Without chip-support modules, embedded AI workflows tend to mix:

- durable project truth
- vendor-specific knowledge
- one-off debugging guesses

emb-agent keeps these separate so the workflow remains stable even when chip-specific logic changes.

The intended chain is:

```text
documents -> staged truth / analysis artifact -> draft chip support -> reviewed reusable support
```

So the operational rule is:

- normal users should be able to finish project work without first wiring up a shared adapters repository
- users can export draft support into a private catalog when they want to keep personal or team-local snapshots
- maintainers can later publish reviewed support into a shared catalog when it becomes reusable

## Reuse-first status

Read chip support in two layers:

- first: `reusable`, `reusable-candidate`, or `project-only`
- second: trust details such as score, evidence gaps, and `recommended_action`

This keeps the user-facing decision simple: "can I reuse this?" comes before "why is the trust score like this?".

Those states also map to repository boundaries:

- `project-only`: keep it local to the current project
- `reusable-candidate`: keep it reviewable and prepare it for promotion
- `reusable`: safe to publish into a shared chip-support catalog

## Trust model

Trust should come from the full evidence chain:

- project truth
- imported document facts
- chip profile coverage
- chip support bindings
- runtime execution readiness

This keeps chip-specific output grounded in evidence instead of letting it behave like opaque magic.
