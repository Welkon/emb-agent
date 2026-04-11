---
name: emb-workflow
description: Author project-local workflow assets with one advanced command family instead of many top-level commands.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-workflow

Use `workflow` for project-local workflow authoring.

Keep this out of the default command path. It is an advanced surface for writing repo-visible workflow assets under `.emb-agent/`.

## Commands

- `workflow init`
  Normalize `.emb-agent/registry/`, `.emb-agent/specs/`, and `.emb-agent/templates/`.
- `workflow list`
  Show the merged built-in and project-local workflow catalog.
- `workflow show registry`
  Show the project-local workflow registry file.
- `workflow show pack <name>`
  Show one pack definition.
- `workflow show spec <name>`
  Show one spec definition.
- `workflow show template <name>`
  Show one template source.
- `workflow new pack <name> [--with-spec [<name>]] [--with-template [<name>]] [--output <path>] [--force]`
  Create a project-local pack and register it. Optional spec/template creation is auto-wired into the same workflow registry.
- `workflow new spec <name> [--pack <name>|--always] [--force]`
  Create a project-local spec and register its injection rule.
- `workflow new template <name> [--output <path>] [--force]`
  Create a project-local template and register its default output.
