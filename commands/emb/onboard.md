---
name: emb-onboard
description: Start the default project onboarding path: scaffold .emb-agent/ for empty repos or audit/migrate existing firmware hardware truth.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-onboard

Use `$emb-onboard` as the default first step when `.emb-agent/` is missing, incomplete, or when existing hardware truth is scattered across datasheets, schematics, pin maps, build files, and notes.

## Purpose

- Choose the lightest safe path before implementation:
  1. empty repo scaffold
  2. partial `.emb-agent/` repair
  3. existing firmware repo migration audit
- Ask the user which path applies before writing hardware or requirement truth.
- Locate schematics, datasheets, pin maps, build files, and product requirements; mark inferred facts separately from confirmed facts.
- Invoke the `emb-onboard` agent for repo audit, user confirmation, and fact extraction.
- Stop after onboarding and return to `next --brief`.


## Required first questions

1. Is this an empty project, an existing firmware project, or a migration from scattered notes?
2. Is the MCU/package already confirmed?
3. Where are schematics, datasheets, pin maps, build files, and product requirements located?
4. May emb-agent write `.emb-agent/hw.yaml`, `.emb-agent/req.yaml`, and `docs/prd/system.md` after confirmation?
## Rules

- Do not guess MCU, package, pins, clock, or peripheral ownership.
- Do not move, delete, or rename existing files without explicit user confirmation.
- If hardware truth already exists in docs, audit and map it before writing `hw.yaml`.
- If the project is concept-stage and MCU is unknown, keep MCU unknown and record requirements/constraints instead.

## Runtime handoff

The runtime `emb-onboard` command returns a compact handoff object for hosts. The human-facing action is:

```text
Invoke emb-onboard → audit/scaffold/migrate → next --brief
```
