---
name: emb-skills
description: Discover, inspect, and run emb runtime skills.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-skills

Use `skills` to inspect, install, and run the lazily loaded skill catalog exposed by `emb-agent`.

Skill is the user-visible capability unit. Installable bundles can ship one or more skills and can be loaded from local paths, npm packages, PyPI packages, or git repositories.

## Commands

- `skills list [--all]`
- `skills show <name>`
- `skills run <name> [--isolated] [input]`
- `skills install [source] [--scope project|user] [--skill <name>] [--force]`
- `skills enable <name>`
- `skills disable <name>`
- `skills remove <name>`

## Notes

- Discovery stays metadata-only; full skill bodies load only on `skills show` or `skills run`.
- OpenAI-style bundled skills can live in directories with `SKILL.md`, optional `scripts/`, and supporting assets.
- Executable skills can be referenced by project quality gates via `quality_gates.required_skills`, so `verify` and `next` can recommend `skills run <name>` directly.
- When `source` is omitted, `skills install` falls back to the default skills repository configured by the runtime. The built-in default is `https://github.com/Welkon/emb-support.git` with the `skills/` subdirectory.
- If the plugin bundle contains a root `package.json` or `requirements.txt`, `skills install` provisions those dependencies into the plugin-local runtime automatically so command skills are runnable immediately after install.
- `plugin.json` can also declare `dependencies.node`, `dependencies.python`, and `dependencies.system_requirements` when the bundle needs explicit runtime setup.
- Project-local installed skill bundles live under `.emb-agent/plugins/`.
- Project-scope installs also materialize host-visible entry skills under host skill directories such as `.codex/skills/` and the shared `.agents/skills/` layer when available.
- User-scope installed skill bundles live under the runtime home plugin directory.
- `--isolated` uses the configured host sub-agent bridge when available.
