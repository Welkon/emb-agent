# Documentation

This directory is the product-facing documentation layer for emb-agent.

If the repository root README explains what emb-agent is, the docs directory should help users answer:

- how do I start?
- which runtime am I using?
- which scenario matches my work?
- which parts are the default embedded path and which parts are support layers around it?
- how are adapters supposed to fit?
- how are tasks supposed to be modeled?

## Start here

- [Product Boundaries](./product-boundaries.md)
  The embedded-first layering between default workflow, support surfaces, and adapters.
- [Quick Start](./quick-start.md)
  The shortest path from install to `init -> declare hardware -> next`.
- [Platforms](./platforms.md)
  Runtime-specific install and path details for Codex and Claude Code.
- [Scenarios](./scenarios.md)
  Real embedded workflows such as known pin maps, brownfield bring-up, and datasheet-first work.

## Product model

- [Product Boundaries](./product-boundaries.md)
  Why this repository contains several layers, while still remaining one embedded product.
- [Adapter Model](./adapter-model.md)
  What belongs in core and what belongs in adapters.
- [Task Model](./task-model.md)
  How task manifests are structured and when to use them.
- [Workflow Layering](./workflow-layering.md)
  How to decide between built-in packs/specs and project-local workflow extensions.

## Examples

- [Smart Pillbox Project Extension](../examples/project-extensions/smart-pillbox/README.md)
- [SC8F072 PWM Bring-up](../examples/sc8f072-pwm/README.md)
- [Brownfield Repo Onboarding](../examples/brownfield-repo-onboarding/README.md)
