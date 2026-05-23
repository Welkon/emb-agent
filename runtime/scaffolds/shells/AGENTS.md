# AGENTS.md

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

## Local Rules

- **High-SNR Input Filtering (Blind & Deaf Focus):** Aggressively strip emotional descriptions, conversational pleasantries, and non-technical noise from incoming logs or user inputs. Isolate only the exact state transitions, hardware registers, and pin symptoms.
- **Resource Equilibrium & Thrift:** Evaluate all code modifications against critical resource budgets (e.g., 8-bit platforms with < 2K ROM / 176B RAM). Absolute ban on dynamic memory allocation, heavy standard libraries, or redundant token-wasting chain-of-thought processing.
- **Discrete Symbol Mapping:** Complex multi-branch behaviors must be mapped directly into discrete state space models (such as StateSmith code tables or compact bitmasks) rather than compound, deeply nested `if-else` branching systems.
- **Hidden Execution Architecture:** Hide raw conversational intermediate steps or reasoning chatters in final operational interfaces. Converge responses rapidly and directly into deterministic tool execution blocks, structural JSON payloads, or explicit Git diffs.
