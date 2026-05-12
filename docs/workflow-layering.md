# Workflow Layering

emb-agent should stay abstract at the core, while still allowing domain-specific workflow guidance where it actually belongs.

## The layers

### 1. Core

Built-in core rules should stay small and universal.

Examples:

- task execution discipline
- truth-first updates
- context hygiene
- verification before mutation

These belong in built-in always-on specs such as core guardrails and task execution.

### 2. Profiles

Profiles describe execution shape, not product category.

Examples:

- `baremetal-loop` for `main_loop_plus_isr`
- `tasked-runtime` for `task_scheduler_plus_isr`

If a rule is really about tasks, queues, locks, ISR boundaries, or scheduler behavior, it probably belongs in a profile or profile-linked spec.

### 3. Built-in baseline specs

Built-in baseline specs represent MCU rules that users should not have to select manually.

Current built-in baseline specs:

- `embedded-space`: generic MCU firmware rules, always auto-injected as the MCU baseline.
- `low-rom-space`: resource-pressure rules, auto-injected only when build/resource evidence indicates constrained ROM/RAM.

These reduce user choice burden while keeping vendor and product details out of the core baseline.

### 4. Selectable or external specs

Selectable specs should represent stable engineering domains with clear reuse across multiple projects, or vendor/toolchain conventions that are detected/imported only when relevant.

Good selectable spec candidates:

- `sensor-node`
- `connected-appliance`
- `battery-charger`
- `motor-drive`
- `scmcu-space`
- `padauk-space`

These describe repeated risk structures such as sampling windows, local/remote consistency, power fallback, fault shutdown, IDE behavior, or compiler dialect constraints.

### 5. Project-local specs and templates

Product-specific workflow guidance should usually live in the project repository under `.emb-agent/`.

Use project-local workflow entries when the language starts sounding like a single product line, customer flow, or business rule set.

Examples:

- smart pillbox adherence logic
- caregiver notification rules
- SKU-specific factory test branching
- one-off board bring-up conventions

Project-local workflow extensions belong in:

- `.emb-agent/registry/workflow.json`
- `.emb-agent/specs/`
- `.emb-agent/templates/`

## Decision rule

Before adding a new built-in or selectable spec, ask:

1. Does this apply to many unrelated embedded projects?
2. Is it an engineering risk pattern rather than a product story?
3. Would another team understand and reuse it without product-specific background?
4. Does it belong in the always-on MCU baseline, a resource-pressure profile, a vendor/toolchain spec, or a project-local rule?

If the answer is "no" to the reuse questions, prefer a project-local extension. If the rule is vendor/compiler/IDE-specific, prefer an external vendor spec instead of `embedded-space`.

## Example

`motor-drive` is a reasonable built-in selectable spec because PWM, current sense, startup, and protection are stable cross-project engineering concerns.

`low-rom-space` is a reasonable built-in baseline spec because ROM/RAM pressure changes implementation tradeoffs across vendors, but it is auto-injected from resource evidence instead of shown as a manual user choice.

`scmcu-space` and `padauk-space` are reasonable external vendor specs because constrained toolchain rules, IDE behavior, syntax limits, and naming traps recur across many unrelated projects for those vendors.

`smart-pillbox` is better treated as a project-local selectable spec, because adherence state, reminder semantics, and caregiver flows are product-specific.

Code-writing specs are narrower than workflow specs. Mark reusable source-editing rules with `enforcement_scope: code-writing` so they are required during implementation, but do not become bootstrap, scan, planning, or project-management instructions.

See [Smart Pillbox Project Extension](../examples/project-extensions/smart-pillbox/README.md) for a concrete example.
