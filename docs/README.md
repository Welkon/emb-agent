# Documentation

This directory is the product-facing documentation layer for emb-agent.

If the repository root README explains what emb-agent is, the docs directory should help users answer:

- how do I start?
- which runtime am I using?
- which scenario matches my work?
- which parts are the default embedded path and which parts are support layers around it?
- how is chip support supposed to fit?
- how are tasks supposed to be modeled?

## Start here

- [Product Boundaries](./product-boundaries.md)
  The embedded-first layering between default workflow, support surfaces, and chip support.
- [Quick Start](./quick-start.md)
  The shortest path from install to either `start -> declare hardware -> next` or `start -> req truth -> next` when MCU is still unknown.
- [Platforms](./platforms.md)
  Runtime-specific install and path details for Codex, Claude Code, and Cursor.
- [Scenarios](./scenarios.md)
  Real embedded workflows such as known pin maps, brownfield bring-up, and datasheet-first work.

## Product model

- [Product Boundaries](./product-boundaries.md)
  Why this repository contains several layers, while still remaining one embedded product.
- [Chip Support Model](./chip-support-model.md)
  What belongs in core and what belongs in chip support.
- [Task Model](./task-model.md)
  How task manifests are structured and when to use them.
- [Workflow Layering](./workflow-layering.md)
  How to decide between built-in packs/specs and project-local workflow extensions.

## Examples

- [Smart Pillbox Project Extension](../examples/project-extensions/smart-pillbox/README.md)
- [PMB180B PWM Bring-up](../examples/pmb180b-pwm/README.md)
