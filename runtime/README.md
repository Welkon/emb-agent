# emb-agent runtime

This directory contains the installed emb-agent runtime that lives under the host configuration directory.
Officially supported hosts are `Codex` and `Claude Code`.

## Host Conventions

- `Codex`
  `runtime-home = ~/.codex`
  `host-config = config.toml`
- `Claude Code`
  `runtime-home = ~/.claude`
  `host-config = settings.json`

Unified runtime entry:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs
```

Unified script entry:

```bash
node <runtime-home>/emb-agent/scripts/init-project.cjs
```

Project state is stored by default at:

```text
<runtime-home>/state/emb-agent/projects/
```

## Directory Roles

- `bin/`
  Main CLI entry.
- `hooks/`
  Host hook scripts such as `SessionStart` and context-hygiene reminders.
- `lib/`
  Internal runtime libraries, including session, handoff, scheduling, dispatch, and host/path resolution.
- `scripts/`
  Runtime helper scripts such as `init-project`, `attach-project`, `ingest-doc`, and `adapter-derive`.
- `templates/`
  Fixed output templates.
- `profiles/`
  Built-in project profiles.
- `packs/`
  Built-in scenario packs.
- `tools/`
  Core abstract tool specs.
- `chips/`
  Core abstract chip registry.
- `extensions/`
  Optional extension root. It is created only when `adapter sync`, `adapter derive`, or the first extension-registry write is executed.
- `state/default-session.json`
  Default session seed state.
- `config.json`
  Runtime configuration.
- `HOST.json`
  Host metadata written during installation and used to resolve the real host/path layout.
- `VERSION`
  Installed runtime version.

## Minimum Maintenance Commands

Initialize or attach a project:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs init
node <runtime-home>/emb-agent/bin/emb-agent.cjs health
node <runtime-home>/emb-agent/bin/emb-agent.cjs next
node <runtime-home>/emb-agent/bin/emb-agent.cjs dispatch next
```

For peripheral-formula, pin, or register-location problems, check whether `next` / `dispatch next` already provides `tool_recommendation` or `tool_execution`.

If `health` / `next` / `adapter status` already exposes `adapter_health`, `quality_overview`, or tool `trust`, follow `recommended_action` first before treating tool output as ground truth.

Close down context:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs pause
node <runtime-home>/emb-agent/bin/emb-agent.cjs resume
```

Check runtime update state:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs update
```

Show runtime help:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs help
```

## Maintenance Boundaries

- This is installed runtime state, not a project deliverable.
- Project-specific mutable content should be written back into `./.emb-agent/` and `./docs/` inside the repository.
- Host-specific differences should live in `HOST.json + runtime-host.cjs` instead of scattered hard-coded references to `~/.codex` or `~/.claude`.
- User-facing workflow guidance belongs in the main [README](../README.md) and runtime help output, not in a duplicated runtime manual here.
