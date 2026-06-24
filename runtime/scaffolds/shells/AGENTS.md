# AGENTS.md

<!-- EMB-AGENT:START -->
## Quick Routing

{{INCLUDE:_partials/quick-routing-table.md}}

## Auto Triggers

{{INCLUDE:_partials/auto-trigger-closure.md}}
- If the task added a new pattern, exposed a new trap, found a missing rule, or invalidated an old rule, update the corresponding workflow or rules file before closure.
- If the task splits into multiple independent sub-tasks, switch to the subagent-driven workflow instead of continuing inline.
- If the host exposes a subagent/delegation tool, use it before broad firmware work that spans multiple peripherals, power/sleep behavior, toolchain migration, SDK/library integration, system framework design, or implementation plus review. First list available agents, then dispatch read-only scouts/reviewers or focused workers instead of continuing entirely inline.
{{INCLUDE:_partials/auto-trigger-load-bearing.md}}

## Red Flags - STOP

{{INCLUDE:_partials/red-flags-stop.md}}

## Human-Readable Defaults

{{INCLUDE:_partials/human-readable-defaults.md}}

{{LANGUAGE_INSTRUCTION}}

## Local Rules

Add project-specific rules here. For embedded defaults, see `.emb-agent/rules/local.md`.

## emb-agent

Start: `.emb-agent/` missing → `onboard`. Otherwise → `next --brief`. Use `help` for full command list.

Core rules:
- Never guess hardware facts. Read `.emb-agent/hw.yaml` and `.emb-agent/req.yaml`.
- Trust `agent_protocol.gate` — it tells you what actions are allowed right now.
- After editing truth files or PRDs, run `validate` or `health`.
- Split work into vertical tracer-bullet slices.
- Prefer subagent orchestration for multi-domain embedded work: hardware/register evidence scout, implementation worker, and architecture/system reviewer when those agents are available.
- Use `mem search/context/extract` when prior local Claude Code / Codex / Pi sessions may contain relevant decisions, fixes, or brainstorm context; decide case-by-case whether to cite, update PRD/design/task notes, or keep it as background.

For detailed procedures, read command docs on demand:
- PRD / tasks / bugs / knowledge → `.<host>/emb-agent/commands/emb/`
- Project truth files → `.emb-agent/`
<!-- EMB-AGENT:END -->
