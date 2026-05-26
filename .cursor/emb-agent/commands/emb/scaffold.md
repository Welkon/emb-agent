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

Use skill scaffolds only for project-specific host integration or repeatable local capabilities. Do not absorb generic skill packs wholesale into emb-agent core; reusable engineering discipline belongs in commands, agents, workflow specs, or project truth, while executable host skills remain optional integration surfaces.

## Commands

- `scaffold list`
  Show the built-in scaffold catalog.
- `scaffold show <name>`
  Show one scaffold entry and the files it will install.
- `scaffold install <name> [output] [--force] [KEY=VALUE ...]`
  Copy the scaffold tree, replace mechanical placeholders such as `{{NAME}}`, and report every remaining `FILL:` marker that still requires judgment.
