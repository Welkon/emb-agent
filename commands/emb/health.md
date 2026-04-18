---
name: emb-health
description: Check whether project truth, chip support reuse status, session state, and cache are healthy.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-health

## Purpose

- Check whether project truth, host startup readiness, chip support, session state, and cache are healthy.
- Read chip-support results in this order: `reusable` / `reusable-candidate` / `project-only` first, then trust details.

## Usage

- Run `$emb-health` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- Use it first when automatic startup seems inactive or bootstrap is blocked before hardware or chip support stages.
- When `health` recommends chip-support work from a hardware document, prefer the analysis-artifact flow: `support analysis init` first, then `support derive --from-analysis`.
