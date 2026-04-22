# Chip Support Model

emb-agent core stays abstract on purpose.

The core should own workflow, truth layers, state continuity, and tool contracts. Vendor-, family-, and chip-specific formulas should live in chip-support modules.

## What belongs in core

Core responsibilities:

- `start`, `declare hardware`, `next`, and the default embedded workflow
- project truth files such as `hw.yaml` and `req.yaml`
- task manifests and task-local context
- session continuity and pause/resume
- abstract tool/chip registries and command contracts

Core should not pretend every embedded vendor stack shares the same build, flash, or debug implementation.

## Analysis artifact boundary

When chip support needs to be derived from datasheets, manuals, or schematics, emb-agent should not jump from raw documents straight into ready support.

Use a constrained middle layer instead:

- document ingest extracts text and staged facts
- an analysis artifact captures evidence-backed chip understanding
- `support derive` / `support generate` turn that artifact into draft adapters

This keeps AI useful without letting it freely write support as if it were already production truth.

## What belongs in chip support

Chip support should own:

- family/device/chip-specific formulas
- tool routes and algorithm implementations
- chip profiles and package-specific pin information
- vendor-specific derived constraints and binding rules
- draft bindings generated from structured analysis artifacts

Examples:

- timer calculation logic for a vendor family
- PWM output pin constraints for one device line
- chip-specific peripheral availability

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
