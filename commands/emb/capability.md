---
name: emb-capability
description: Inspect, run, and materialize first-class workflow capabilities.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - SlashCommand
---

# emb-capability

Use `capability` as the workflow execution surface.

This is the primary capability-first surface for workflow work and generator-backed materialization.

## Commands

- `capability list [--all]`
  Show workflow capabilities. Use `--all` to include runtime surfaces such as `next`, `status`, and `health`.
- `capability show <name>`
  Show one capability, its route metadata, and its materialization plan.
- `capability run <name>`
  Execute one workflow capability directly through the capability runtime.
- `capability materialize [<name>|all] [--force]`
  Generate project-local workflow specs and templates for one capability or the full capability set.
