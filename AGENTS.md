<!-- EMB-AGENT:START -->
# emb-agent Instructions

These instructions are for AI assistants working in this project.

Use the `start` command when starting a new session to:
- Initialize the project if needed
- Understand current project truth
- Get the shortest next step

Use `.emb-agent/` to learn:
- Project truth (`project.json`, `hw.yaml`, `req.yaml`)
- Task workflow (`tasks/`)
- Project-local specs (`specs/`)

Host-specific helpers may also live in:
- `.codex/skills/` for Codex emb-agent command mirrors
- `.claude/commands/emb/` for Claude Code slash command mirrors
- `.cursor/commands/` for Cursor command wrappers
- `.pi/extensions/` and `.pi/skills/` for Pi command wrappers and skills
- `.codex/agents/`, `.claude/agents/`, or `.cursor/agents/` for optional custom agents

Keep this managed block so future emb-agent updates can refresh the instructions.

<!-- EMB-AGENT:END -->
