# emb-agent runtime

This directory contains the installed emb-agent runtime that lives under the host configuration directory.
Officially supported host-integrated runtimes are `Codex` and `Claude Code`.

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

## Hook Contract

Runtime hook helpers use one structured dispatch contract only.

- `runtime/lib/hook-dispatch.cjs`
  `runHookWithProjectContext(rawInput, handler)` returns a structured result with:
  `trusted`, `status`, `event`, `cwd`, `project_root`, `output`, `runtime_events`
- Hook scripts should compute their real host-facing payload inside `result.output`
- Hook modules may return the full structured result; `runHookCli(entrypoint)` unwraps `result.output`
- `runHookCli(entrypoint)` automatically unwraps `result.output` before writing to `stdout`
- Untrusted workspaces do not execute hook handlers; they return `status = skipped` and empty `output`

Practical pattern:

```js
function runHook(rawInput) {
  return hookDispatch.runHookWithProjectContext(rawInput, ({ data, projectRoot }) => {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: data.hook_event_name || data.event || 'PostToolUse',
        additionalContext: `Project root: ${projectRoot}`
      }
    });
  });
}
```

## Minimum Maintenance Commands

Initialize or attach a project:

```bash
node <runtime-home>/emb-agent/bin/emb-agent.cjs init
node <runtime-home>/emb-agent/bin/emb-agent.cjs health
node <runtime-home>/emb-agent/bin/emb-agent.cjs next
node <runtime-home>/emb-agent/bin/emb-agent.cjs dispatch next
```

For peripheral-formula, pin, or register-location problems, check whether `next` / `dispatch next` already provides `tool_recommendation` or `tool_execution`.

If `health` / `next` / `support status` already exposes `chip_support_health` or `quality_overview`, read the reuse state first:

- `reusable`: current chip support is ready to reuse across projects
- `reusable-candidate`: current chip support looks shareable after review
- `project-only`: keep the current chip support local for now

Then use `recommended_action` and tool `trust` as the second layer before treating tool output as ground truth.

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

If a host skill or external driver needs a fixed protocol, prefer:

```bash
node ./.emb-agent/runtime/bin/emb-agent.cjs external start
node ./.emb-agent/runtime/bin/emb-agent.cjs external next
node ./.emb-agent/runtime/bin/emb-agent.cjs external health
node ./.emb-agent/runtime/bin/emb-agent.cjs external dispatch-next
node ./.emb-agent/runtime/bin/emb-agent.cjs external status
```

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
