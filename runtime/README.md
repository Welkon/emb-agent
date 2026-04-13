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
- `scaffolds/`
  Fixed scaffold trees for skill, shell, hook, and protocol bootstrap. Structure may be prebuilt here; project content must still be filled explicitly.
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
- package-root `skills/`
  Built-in skills discovered lazily by the runtime. Metadata is listed first; full bodies load only on `skills show` or `skills run`.
- package-root `memory/`
  Built-in instruction-memory layers such as organization guidance that can be stacked with user, project, and local memory.
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

Inspect reusable skills and layered memory:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs skills list
node <runtime-home>/emb-agent/bin/emb-agent.cjs skills show swarm-execution
node <runtime-home>/emb-agent/bin/emb-agent.cjs memory stack
node <runtime-home>/emb-agent/bin/emb-agent.cjs memory audit
```

`pause` also performs one auto-memory extraction pass so reusable conclusions can be reviewed later instead of being lost in session-only state.

Check runtime update state:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs update
```

Show runtime help:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs help
```

## Host Sub-Agent Bridge

`dispatch run` and `orchestrate run` now emit and persist a real delegation runtime under session diagnostics.

Delegation pattern is selected from `preferences.orchestration_mode`:

- `auto`
  Conservative default. Resolves to `coordinator`.
- `coordinator`
  One primary worker integrates supporting outputs.
- `fork`
  Workers inherit the parent context snapshot and return directly for integration.
- `swarm`
  Flat peer roster with one `peer-lead` and supporting `peer` workers.

If the host wants emb-agent to actually launch sub-agents, configure a bridge command that accepts a JSON payload on `stdin` and returns a JSON worker result on `stdout`:

```bash
export EMB_AGENT_SUBAGENT_BRIDGE_CMD='node /path/to/host-subagent-bridge.cjs'
```

Bridge contract:

- Input: one JSON payload containing session summary, dispatch contract, worker envelope, and a self-contained worker prompt.
- Output: one JSON payload containing `status` and `worker_result`.
- Runtime users can steer the pattern with `prefs set orchestration_mode <auto|coordinator|fork|swarm>`.
- `skills run <name> --isolated` also uses the bridge when a skill declares isolated execution.
- Fallback: if no bridge is configured, emb-agent keeps the launch request and marks synthesis as `blocked-no-host-bridge` instead of pretending delegation already happened.

## Maintenance Boundaries

- This is installed runtime state, not a project deliverable.
- Project-specific mutable content should be written back into `./.emb-agent/` and `./docs/` inside the repository.
- Host-specific differences should live in `HOST.json + runtime-host.cjs` instead of scattered hard-coded references to `~/.codex` or `~/.claude`.
- User-facing workflow guidance belongs in the main [README](../README.md) and runtime help output, not in a duplicated runtime manual here.
