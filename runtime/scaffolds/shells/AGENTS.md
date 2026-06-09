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

{{INCLUDE:_partials/human-readable-defaults.md}}

{{LANGUAGE_INSTRUCTION}}

## Local Rules

- **High-SNR Input Filtering (Blind & Deaf Focus):** Aggressively strip emotional descriptions, conversational pleasantries, and non-technical noise from incoming logs or user inputs. Isolate only the exact state transitions, hardware registers, and pin symptoms.
- **Resource Equilibrium & Thrift:** Evaluate all code modifications against critical resource budgets (e.g., 8-bit platforms with < 2K ROM / 176B RAM). Absolute ban on dynamic memory allocation, heavy standard libraries, or redundant token-wasting chain-of-thought processing.
- **Discrete Symbol Mapping:** Complex multi-branch behaviors must be mapped directly into discrete state space models (such as StateSmith code tables or compact bitmasks) rather than compound, deeply nested `if-else` branching systems.
- **Hidden Execution Architecture:** Hide raw conversational intermediate steps or reasoning chatters in final operational interfaces. Converge responses rapidly and directly into deterministic tool execution blocks, structural JSON payloads, or explicit Git diffs.

## emb-agent

Start: `.emb-agent/` missing → `onboard`. Otherwise → `next --brief`. Use `help` for full command list.

Core rules:
- Never guess hardware facts. Read `.emb-agent/hw.yaml` and `.emb-agent/req.yaml`.
- Trust `agent_protocol.gate` — it tells you what actions are allowed right now.
- After editing truth files or PRDs, run `validate` or `health`.
- Split work into vertical tracer-bullet slices.

For detailed procedures, read command docs on demand:
- PRD / tasks / bugs / knowledge → `.<host>/emb-agent/commands/emb/`
- Project truth files → `.emb-agent/`
<!-- EMB-AGENT:END -->
