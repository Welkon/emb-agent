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

## Workflow Discipline

- `scan` should narrow unknowns and evidence gaps before implementation, especially when hardware truth, parser coverage, chip support, or task scope is still fuzzy.
- `plan` should produce a small number of falsifiable steps and name the verification surface before `do`.
- `do` should move one vertical slice at a time and keep changes tied to the task PRD or runtime recommendation.
- `debug` should start from reproduction and ranked hypotheses, not broad code changes.
- `review` should separate confirmed findings from advisory improvements, including schematic and PCB advice.
- `verify` should prefer behavior evidence from public surfaces, generated artifacts, hardware documents, or bench steps over implementation-only checks.
