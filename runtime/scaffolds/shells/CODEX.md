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

- Keep guidance hardware-first and name the real blocker.
- Give the exact next command or file before adding extra structure.
- Treat skills, hooks, extensions, and wrappers as integration surfaces; they must not override emb-agent runtime gates.
- Avoid generic AI or project-management wording when a concrete board action, artifact, or truth file is known.

## Codex Notes

- Reuse the shared protocol blocks from `templates/protocol-blocks/`.
- Do not add project-specific defaults here without passing the anti-template test.
- The template should remember harness infrastructure so the skill author can focus on project truth.
- Treat `agent_protocol.gate` fields from emb-agent JSON as authoritative; execute allowed host actions yourself and never ask the user to run emb-agent commands manually.

## emb-agent Instructions

These instructions are for AI assistants working in this project.

Use emb-agent commands to:
- Initialize or onboard the project
- Understand current project truth
- Get the shortest next step

Use `onboard` first when `.emb-agent/` is missing or hardware truth is undeclared.
Use `next` for the default continuation once the project is ready.
Use `help` to see the full command surface.

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
