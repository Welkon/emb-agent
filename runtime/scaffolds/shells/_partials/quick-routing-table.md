| Task | Required reads | Workflow |
| --- | --- | --- |
| Project not initialized or hardware truth missing | `AGENTS.md`; `.emb-agent/hw.yaml`; `.emb-agent/req.yaml`; `docs/` schematics/manuals/datasheets | Run `/emb-start` or the installed runtime's `start --brief` command before implementation |
| Need the next allowed step | `.emb-agent/project.json`; `.emb-agent/tasks/`; `docs/prd/`; `docs/` hardware evidence when gate says hardware-first | Run `/emb-next` or the installed runtime's `next --brief` command and follow `agent_protocol.gate` |
| Need to understand the current service split, scheduler path, or time-slice flow | Active task PRD if one exists; `.emb-agent/hw.yaml`; `.emb-agent/req.yaml`; only the in-scope source files | Explain the current structure first. Do not force task creation just to answer a design or readability question |
| Narrow analysis, one-off verification, or small scoped fix | `.emb-agent/hw.yaml`; `.emb-agent/req.yaml`; scoped source files tied to the request | Work can proceed directly once the scope and verification surface are explicit; use a task only if the work becomes multi-step or resumable |
| Multi-step firmware implementation | `.emb-agent/hw.yaml`; `.emb-agent/req.yaml`; active task PRD | Follow scan → plan → do → review → verify |
| Bug fix or regression | `.emb-agent/compound/`; `.emb-agent/issues/`; failing evidence | Reproduce first, then fix at source |
| Knowledge capture after work | `.emb-agent/reference/knowledge-evolution.md` | Record repeatable, expensive, or non-obvious lessons only when a durable lesson actually emerged |
| External toolchain or lab workflow | Installed external `SKILL.md` under `.<host>/skills/` or `.agents/skills/` | Read the selected skill before matching work |
