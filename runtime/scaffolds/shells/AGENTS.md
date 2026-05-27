# AGENTS.md

<!-- EMB-AGENT:START -->
## Quick Routing

{{INCLUDE:_partials/quick-routing-table.md}}

## Auto Triggers

{{INCLUDE:_partials/auto-trigger-closure.md}}
- If the task added a new pattern, exposed a new trap, found a missing rule, or invalidated an old rule, update the corresponding workflow or rules file before closure.
- If the task splits into multiple independent sub-tasks, switch to the subagent-driven workflow instead of continuing inline.
{{INCLUDE:_partials/auto-trigger-load-bearing.md}}

## Red Flags - STOP

{{INCLUDE:_partials/red-flags-stop.md}}

## Human-Readable Defaults

- Keep guidance hardware-first and name the real blocker.
- Give the exact next command or file before adding extra structure.
- Treat skills, hooks, extensions, and wrappers as integration surfaces; they must not override emb-agent runtime gates.
- Avoid generic AI or project-management wording when a concrete board action, artifact, or truth file is known.

{{LANGUAGE_INSTRUCTION}}

## Local Rules

- **High-SNR Input Filtering (Blind & Deaf Focus):** Aggressively strip emotional descriptions, conversational pleasantries, and non-technical noise from incoming logs or user inputs. Isolate only the exact state transitions, hardware registers, and pin symptoms.
- **Resource Equilibrium & Thrift:** Evaluate all code modifications against critical resource budgets (e.g., 8-bit platforms with < 2K ROM / 176B RAM). Absolute ban on dynamic memory allocation, heavy standard libraries, or redundant token-wasting chain-of-thought processing.
- **Discrete Symbol Mapping:** Complex multi-branch behaviors must be mapped directly into discrete state space models (such as StateSmith code tables or compact bitmasks) rather than compound, deeply nested `if-else` branching systems.
- **Hidden Execution Architecture:** Hide raw conversational intermediate steps or reasoning chatters in final operational interfaces. Converge responses rapidly and directly into deterministic tool execution blocks, structural JSON payloads, or explicit Git diffs.

## emb-agent Instructions

These instructions are for AI assistants working in this project.

Use emb-agent commands to:
- Initialize or onboard the project
- Understand current project truth
- Get the shortest next step

Use `onboard` first when `.emb-agent/` is missing or hardware truth is undeclared.
Use `next` for the default continuation once the project is ready.
Use `help` for the default command flow. All installed command docs remain available under the host runtime (for example `.omp/emb-agent/commands/emb/` or `.pi/emb-agent/commands/emb/`); prefer `onboard` and `next`, but use specialized commands when runtime output or the user request calls for them.

### Project Truth

- Hardware truth: `.emb-agent/hw.yaml`
- Requirements: `.emb-agent/req.yaml` and `docs/prd/`
- Knowledge (traps/tricks/decisions/learnings): `.emb-agent/compound/`
- Architecture: `.emb-agent/architecture/`
- Active tasks: `.emb-agent/tasks/`

### Session Flow

1. On session start, the host auto-injects emb-agent context.
2. If `.emb-agent/` is missing or incomplete, route to `onboard`.
3. Follow the recommended next step (`next --brief`).
4. After every non-trivial workflow exit, run the post-flow knowledge capture checklist.

### Rules

- Never guess hardware facts. Read `.emb-agent/hw.yaml` and `.emb-agent/req.yaml`.
- Run `next --brief` after significant state changes.
- Trust `agent_protocol.gate` — it tells you what actions are allowed right now.

<!-- EMB-AGENT:END -->
