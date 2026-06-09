# CODEX.md

<!-- EMB-AGENT:START -->
## Quick Routing

{{INCLUDE:_partials/quick-routing-table.md}}

## Auto Triggers

{{INCLUDE:_partials/auto-trigger-closure.md}}
- Re-read `AGENTS.md` and `.codex/instructions.md` before starting a new workstream after compression or resume.
{{INCLUDE:_partials/auto-trigger-load-bearing.md}}

## Red Flags - STOP

{{INCLUDE:_partials/red-flags-stop.md}}

## Human-Readable Defaults

{{INCLUDE:_partials/human-readable-defaults.md}}

{{LANGUAGE_INSTRUCTION}}

## Codex Notes

- Treat `agent_protocol.gate` fields from emb-agent JSON as authoritative; execute allowed host actions yourself and never ask the user to run emb-agent commands manually.

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
