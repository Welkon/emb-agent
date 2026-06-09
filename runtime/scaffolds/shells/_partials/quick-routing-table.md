| Task | Required reads | Workflow |
| --- | --- | --- |
| Project not initialized or hardware truth missing | `AGENTS.md`; `.emb-agent/hw.yaml`; `.emb-agent/req.yaml` | Run `/emb-onboard` or the installed runtime's `onboard` command before implementation |
| Need the next allowed step | `.emb-agent/project.json`; `.emb-agent/tasks/`; `docs/prd/` | Run `/emb-next` or the installed runtime's `next --brief` command and follow `agent_protocol.gate` |
| Multi-step firmware implementation | `.emb-agent/hw.yaml`; `.emb-agent/req.yaml`; active task PRD | Follow scan → plan → do → review → verify |
| Bug fix or regression | `.emb-agent/compound/`; `.emb-agent/issues/`; failing evidence | Reproduce first, then fix at source |
| Knowledge capture after work | `.emb-agent/reference/knowledge-evolution.md` | Record repeatable, expensive, or non-obvious lessons in `.emb-agent/compound/` |
| External toolchain or lab workflow | Installed external `SKILL.md` under `.<host>/skills/` or `.agents/skills/` | Read the selected skill before matching work |
