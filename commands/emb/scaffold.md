---
name: emb-scaffold
description: Install fixed scaffold trees with mechanical placeholder replacement and explicit FILL checkpoints.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-scaffold

Use `scaffold` for advanced bootstrap work where structure should be copied, not regenerated.

This command family is intentionally separate from `workflow`. `workflow` authors project-local runtime assets under `.emb-agent/`; `scaffold` copies higher-level skeleton trees such as skills, hooks, shells, and protocol blocks.

This is support-maintenance surface for the embedded workflow, not default firmware-project flow.

## Commands

- `scaffold list`
  Show the built-in scaffold catalog.
- `scaffold show <name>`
  Show one scaffold entry and the files it will install.
- `scaffold install <name> [output] [--force] [KEY=VALUE ...]`
  Copy the scaffold tree, replace mechanical placeholders such as `{{NAME}}`, and report every remaining `FILL:` marker that still requires judgment.
