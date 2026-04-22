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
- `workflow import registry <source> [--branch <name>] [--subdir <path>] [--force]`
  Import project-local workflow specs and templates from a local path or git repository into `.emb-agent/`.
- `workflow show registry`
  Show the project-local workflow registry file.
- `workflow show <spec|template> <name>`
  Show one project-local spec or template definition.
- `workflow new spec <name> [--with-template [<name>]] [--output <path>] [--force]`
  Create a project-local selectable spec and register it.
- `workflow new spec <name> [--spec <name>|--always] [--with-template [<name>]] [--output <path>] [--force]`
  Create an additional auto-injected spec that applies when the named spec is active, or always.
- `workflow new template <name> [--output <path>] [--force]`
  Create a project-local template and register its default output.
