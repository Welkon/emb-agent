---
name: low-rom-space
title: Low ROM Space
summary: ROM/RAM-constrained MCU firmware rules: direct state, bounded slicing, helper gates, map-driven abstraction, and resource-budget review.
selectable: false
priority: 60
enforcement_scope: code-writing
focus_areas: [rom_budget, ram_budget, direct_state, time_base_slicing, helper_gate, abstraction_cost, map_file_review]
extra_review_axes: [map_file_budget, helper_cost, dispatch_cost, table_cost, stack_cost, registration_cost, resource_headroom]
---

# Low ROM Space

Use this spec when an MCU project has tight or unknown ROM/RAM headroom and feature code must be justified against measured build output.
Pair it with `embedded-space` for generic MCU safety/ownership rules and with vendor specs such as `scmcu-space` or `padauk-space` for compiler and IDE conventions.

- **Specs are coding constraints only.** Record the memory budget numbers and size gates here. Record *why* those numbers were chosen in `.emb-agent/wiki/decisions/`.

## Core Stance (The Subtractive Principle)

- **Shallowest Path Victory:** When two correct implementations exist, choose the smaller, shallower, and more direct one. Zero tolerance for anticipatory abstractions before the build map file proves available headroom.
- **Pruning Over Shielding:** Prefer deleting unused logic or simplifying operational assumptions over layering defensive protection wrappers.
- **Direct Reality Mapping:** Enforce direct state representation. Absolute ban on compound encode/decode, serialize/deserialize, or normalize/re-encode transformation layers.
- **Cost Justification:** Every wrapper, helper, lookup table, function pointer, or indirect handle is a critical resource drain. It must buy its way into the firmware by proving an unresolvable safety or verification benefit.
- **Evidence Over Intuition:** Do not rely on nominal chip flash dimensions or developer intuition. Use the current build's linker memory map and listing file as the single source of resource truth.

## Budget Gates

- Project-local specs or hardware/requirement truth may define stricter ROM/RAM limits. Use those over this generic policy.
- If ROM/RAM usage is unknown, stay in conservative mode until a build proves the budget.
- **Conservative Mode:** Use flat, direct, naked C logic by default when the required budget is unknown, program ROM usage is `>= 80%`, data RAM usage is `>= 75%`, or declared safety reserve limits would be crossed.
- **Balanced Mode:** Allow thin module boundaries, distinct object handles, and compact static lookup tables when program ROM is `< 70%` and data RAM remains below warning gates.
- **Interface Mode:** Allow abstract operations tables, base handles, and opaque hardware structures only when program ROM is `< 60%` and expected feature growth leaves the safety reserve intact.
- **Relaxed Mode:** Requires an explicit local override stating available headroom and clear allowance for structural abstraction costs.

## Direct Implementation Rules

- Keep the main loop visually short, flat, and non-nested.
- Enforce strict `Scan -> Handle -> Output` execution sequence.
- Prefer fixed-width integer primitives, direct register calls, and file-local `static` memory states to avoid stack-frame overhead.
- Keep single-use logic inline unless extraction lowers flash metrics or fixes a vital invariant.
- Never hide sequential policy branches behind function pointer matrices or operational interfaces when flat state machines are smaller.

## Time Base And Slicing Under Tight Budget

- **Monolithic Cadence:** Prefer a single shared hardware/software tick counter before adding task schedulers, runtime dynamic queues, or callback frames.
- **Minimal ISR Exposure:** Keep timer ISR execution tiny. Only update a volatile tick/phase flag, capture necessary raw hardware state, clear the hardware interrupt source, and exit.
- **Main Loop De-multiplexing:** Split periodic execution blocks in the foreground loop using discrete fixed counters or bitmask phase slots.
- Derive secondary execution tempos from the master tick using simple masks or integer dividers rather than spawning independent software timers.

## Helper Function Gate (Anti-Bloat Barrier)

- Helper functions are an optimization cost, not an aesthetic default for code cleaning.
- **The Entry Gate:** Add a helper function only if it removes verifiable duplicated logic, wraps an isolated hardware instruction, shortens an aggressive hot path, or actively minimizes the compiled ROM footprint.
- **Absolute Prohibitions:** - Do not create a helper that merely renames an expression, proxies a single macro, or isolates an internal transient variable.
  - Do not add a helper if it extends call stack depth inside ISR routines, input debounce loops, or timing-critical paths.
- Keep approved helpers strictly scoped as file-local `static`.

## Tables, Constants, And Data Shape

- Lookup tables drain non-volatile flash space. Retain a table only if it is proven smaller or safer than raw mathematical or discrete switch logic.
- Avoid round-trip abstraction conversions from hardware readings into high-level semantics and back unless it drops duplicate pathways.

## Module Splits And Interfaces

- Reject splitting code files simply based on length metrics. Maintain in-file structural sections over new translation units if the compiler exhibits poor cross-module optimization.
- Any split proposal must explicitly define responsibility boundaries, precise memory metrics, and expected ROM/RAM variations.

## Ops Tables, Callbacks, And Registration

- Use abstract operations tables or function pointer structs only when multiple runtime implementations are explicitly required.
- Prefer explicit constant board arrays or direct initialization sequences over automated or linker-section registration workflows.

## Resource Review Discipline

- **Post-Slice Map Inspection:** After every single code modification or feature addition, immediately scan the map/listing files to inspect top-ranking function sizes and total flash increment.
- If a structural change or abstraction introduces `> 2%` program ROM or `> 1%` data RAM, roll back immediately unless backed by an explicit safety validation requirement.

## Avoid By Default

- Recursive execution flow or nested call depths.
- Global dynamic event buses, heap wrappers, or generic runtime registries.
- `printf`/`sprintf` formatting strings in compiled production binaries.
- Publicly writeable unprotected variables or raw hardware downcasts.
