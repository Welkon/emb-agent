# Chip Support Model

emb-agent core stays abstract on purpose.

The core should own workflow, truth layers, state continuity, and tool contracts. Vendor-, family-, and chip-specific formulas should live in chip support packs.

## What belongs in core

Core responsibilities:

- `init`, `declare hardware`, `next`, and the default embedded workflow
- project truth files such as `hw.yaml` and `req.yaml`
- task manifests and task-local context
- session continuity and pause/resume
- abstract tool/chip registries and command contracts

Core should not pretend every embedded vendor stack shares the same build, flash, or debug implementation.

## What belongs in chip support

Chip support should own:

- family/device/chip-specific formulas
- tool routes and algorithm implementations
- chip profiles and package-specific pin information
- vendor-specific derived constraints and binding rules

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

## Trust model

Trust should come from the full evidence chain:

- project truth
- imported document facts
- chip profile coverage
- chip support bindings
- runtime execution readiness

This keeps chip-specific output grounded in evidence instead of letting it behave like opaque magic.
