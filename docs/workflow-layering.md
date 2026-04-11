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

These belong in built-in specs such as core guardrails and task execution.

### 2. Profiles

Profiles describe execution shape, not product category.

Examples:

- `baremetal-8bit` for `main_loop_plus_isr`
- `rtos-iot` for `task_scheduler_plus_isr`

If a rule is really about tasks, queues, locks, ISR boundaries, or scheduler behavior, it probably belongs in a profile or profile-linked spec.

### 3. Built-in packs

Built-in packs should represent stable engineering domains with clear reuse across multiple projects.

Good built-in pack candidates:

- `sensor-node`
- `connected-appliance`
- `battery-charger`
- `motor-drive`

These describe repeated risk structures such as sampling windows, local/remote consistency, power fallback, or fault shutdown.

### 4. Project-local packs and specs

Product-specific workflow guidance should usually live in the project repository under `.emb-agent/`.

Use project-local workflow entries when the language starts sounding like a single product line, customer flow, or business rule set.

Examples:

- smart pillbox adherence logic
- caregiver notification rules
- SKU-specific factory test branching
- one-off board bring-up conventions

Project-local workflow extensions belong in:

- `.emb-agent/registry/workflow.json`
- `.emb-agent/packs/`
- `.emb-agent/specs/`
- `.emb-agent/templates/`

## Decision rule

Before adding a new built-in pack or spec, ask:

1. Does this apply to many unrelated embedded projects?
2. Is it an engineering risk pattern rather than a product story?
3. Would another team understand and reuse it without product-specific background?

If the answer is "no" to any of those, prefer a project-local extension.

## Example

`motor-drive` is a reasonable built-in pack because PWM, current sense, startup, and protection are stable cross-project engineering concerns.

`smart-pillbox` is better treated as a project-local extension, because adherence state, reminder semantics, and caregiver flows are product-specific.

See [Smart Pillbox Project Extension](../examples/project-extensions/smart-pillbox/README.md) for a concrete example.
