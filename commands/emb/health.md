---
name: emb-health
description: Check whether project truth, adapters, session state, and cache are healthy.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-health

## Purpose

- Check whether project truth, host startup readiness, adapters, session state, and cache are healthy.

## Usage

- Run `$emb-health` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- Use it first when automatic startup seems inactive or bootstrap is blocked before hardware / adapter stages.
