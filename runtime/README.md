# emb-agent runtime

This directory contains the installed emb-agent runtime that lives under the host configuration directory.
Officially supported hosts are `Codex`, `Claude Code`, and `Cursor`. `Pi` and `Windsurf` are experimental and disabled in development builds. `OMP` is currently disabled.

## Host Conventions

- `Codex`
  `runtime-home = ~/.codex`
  `host-config = config.toml`
- `Claude Code`
  `runtime-home = ~/.claude`
  `host-config = settings.json`
- `Cursor`
  `runtime-home = ~/.cursor`
  `host-config = settings.json`
- `Pi`
  `runtime-home = ~/.pi/agent` globally or `./.pi` locally
  `host-integration = extensions/emb-agent.ts + skills/`
Unified runtime entry:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs
```

## Directory Roles

- `bin/`
  Main CLI entry. Wraps the Rust binary (`emb-agent-rs`).
- `commands/`
  Command reference docs (`.md` files used by AI hosts as slash-command docs).
- `agents/`
  Specialized agent definitions (e.g., `onboard`, `fw-doer`).
- `scaffolds/`
  Template trees for host integration (shell instructions, hooks, extensions, skills).
- `templates/`
  Fixed output templates for compound docs, tasks, chip profiles, etc.
- `profiles/`
  Built-in project profiles (e.g., `baremetal-loop`).
- `registry/`
  Workflow/spec catalog metadata.
- `specs/`
  Built-in baseline specs (e.g., `embedded-space`, `low-rom-space`).
- `tools/`
  Core abstract tool specs.
- `config.json`
  Runtime configuration.
- `HOST.json`
  Host metadata written during installation.
- `VERSION`
  Installed runtime version.
- `scripts/`
  Runtime helper scripts (currently: `init-project.cjs`). Note: these scripts are packaged for use by the Rust runtime's `init`/`onboard` flows; they are not independently maintained for direct user invocation.
- `lib/`
  Installer support libraries (`install-helpers.cjs`, `install-targets.cjs`, `runtime-host.cjs`, `terminal-ui.cjs`, `command-visibility.cjs`). These are used by the installer; the runtime itself is primarily in Rust.

## Automation Output

emb-agent exposes three machine-oriented user surfaces:

- `--brief`
  Compact JSON for action-oriented commands (`start`, `next`, `status`, `health`).
- `external <start|status|next|health|dispatch-next>`
  Stable protocol envelope (`emb-agent.external/1`) for host runtimes, skills, and external drivers.
- `task worktree list|status|show|create|cleanup`
  Task worktree lifecycle JSON.

Both `--brief` and `external` expose summarized `runtime_events`:

| Status   | Meaning |
|----------|---------|
| `clear`  | no active runtime signal |
| `ok`     | informational signal only |
| `pending`| follow-up is still recommended |
| `blocked`| execution should pause until the blocker is closed |
| `failed` | a failed step was observed |

### Examples

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs next --brief
node <runtime-home>/emb-agent/bin/emb-agent.cjs external next
node <runtime-home>/emb-agent/bin/emb-agent.cjs external start
node <runtime-home>/emb-agent/bin/emb-agent.cjs external status
node <runtime-home>/emb-agent/bin/emb-agent.cjs external health
node <runtime-home>/emb-agent/bin/emb-agent.cjs external dispatch-next
```

## Common Commands

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs start --brief
node <runtime-home>/emb-agent/bin/emb-agent.cjs next --brief
node <runtime-home>/emb-agent/bin/emb-agent.cjs status --brief
node <runtime-home>/emb-agent/bin/emb-agent.cjs health
node <runtime-home>/emb-agent/bin/emb-agent.cjs doctor --host all --brief
node <runtime-home>/emb-agent/bin/emb-agent.cjs onboard
node <runtime-home>/emb-agent/bin/emb-agent.cjs init
node <runtime-home>/emb-agent/bin/emb-agent.cjs update
node <runtime-home>/emb-agent/bin/emb-agent.cjs help
```

## Maintenance Boundaries

- This is installed runtime state, not a project deliverable.
- Project-specific content lives in `./.emb-agent/` and `./docs/prd/`.
- Host-specific differences live in `HOST.json` and the installed `.host` integration directory.
- User-facing workflow guidance belongs in the main [README](../README.md) and the runtime help output.
