# Chip Support Model

emb-agent core stays abstract on purpose.

The core should own workflow, truth layers, state continuity, and tool contracts. Vendor-, family-, and chip-specific formulas should live in chip support packs.

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

## Why this split matters

Without chip support packs, embedded AI workflows tend to mix:

- durable project truth
- vendor-specific knowledge
- one-off debugging guesses

emb-agent keeps these separate so the workflow remains stable even when chip-specific logic changes.

The intended chain is:

```text
documents -> staged truth / analysis artifact -> draft chip support -> reviewed reusable support
```

## Reuse-first status

Read chip support in two layers:

- first: `reusable`, `reusable-candidate`, or `project-only`
- second: trust details such as score, evidence gaps, and `recommended_action`

This keeps the user-facing decision simple: "can I reuse this?" comes before "why is the trust score like this?".

## Trust model

Trust should come from the full evidence chain:

- project truth
- imported document facts
- chip profile coverage
- chip support bindings
- runtime execution readiness

This keeps chip-specific output grounded in evidence instead of letting it behave like opaque magic.
