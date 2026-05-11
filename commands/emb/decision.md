---
name: emb-decision
description: Review and record technical decisions before implementation.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-decision

## Purpose

- Make technical choices auditable before implementation.
- Use this when the user request already assumes a framework, architecture, protocol, concurrency model, hardware route, or other load-bearing choice.
- Counter model sycophancy: do not silently implement a user-suggested choice until the problem, alternatives, tradeoffs, and evidence have been reviewed.

## Usage

- Run `$emb-decision` when the current step depends on an unconfirmed technical decision.
- Use `decision review --question <text>` to create a blocking AI-host review gate with questions the human or AI must answer before coding.
- Use `decision record --question <text> --chosen <choice>` once the decision is explicit. Add `--option`, `--reject <option>::<reason>`, `--evidence`, and `--note` when available.
- After recording, return to `next` so emb-agent decides the legal workflow step.
- Do not use a recorded decision as a shortcut around PRD, task, health, permission, or verification gates.

## Examples

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs decision review --question "Should this state be stored in Redux?" --option Redux --option local-state --evidence docs/prd/system.md --brief
node ~/.codex/emb-agent/bin/emb-agent.cjs decision record --question "Should this state be stored in Redux?" --chosen local-state --option Redux --reject "Redux::too heavy for local component lifecycle" --evidence docs/prd/system.md --brief
```
