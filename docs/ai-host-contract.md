# AI Host Contract

emb-agent is a workflow protocol provider, not the final conversational UI.

## Roles

- emb-agent owns workflow state, gates, recommendations, and machine-readable evidence.
- The AI host owns narration, path selection within allowed gates, and human-facing language.
- Humans should normally see the AI host's concise explanation, not raw emb-agent JSON or long CLI transcripts.

## Protocol field

Command outputs are enriched with `agent_protocol` when emb-agent can infer a route:

```json
{
  "agent_protocol": {
    "version": "emb-agent.protocol/1",
    "audience": "ai-host",
    "visibility": {
      "raw_output": "hidden-from-human-by-default",
      "human_output_owner": "host-ai"
    },
    "gate": {
      "kind": "prd-breakdown",
      "blocking": true,
      "allowed_actions": ["read_system_prd", "present_prd_task_candidates", "create_vertical_child_prds", "run_validate_or_health_after_prd_edits"],
      "forbidden_actions": ["ask_user_for_blank_task_when_system_prd_has_candidates", "scan", "plan", "do"]
    },
    "recommendation": {
      "command": "/emb-next"
    },
    "ai_instruction": {
      "ask_user": "我会先把现有系统 PRD 拆成可执行任务 PRD，并在验证后请你确认。",
      "raw_output_policy": "Machine output is for AI routing only; do not paste it verbatim to the human."
    }
  }
}
```

## Host requirements

AI hosts and command wrappers must:

1. Treat emb-agent output as machine protocol.
2. Respect `agent_protocol.gate.allowed_actions` and `agent_protocol.gate.forbidden_actions`.
3. Ask the human only for the next needed confirmation or input.
4. If `agent_protocol.gate.kind` is `prd-exploration`, do not confirm PRD, create/activate tasks, or create child execution PRDs yet: ask detailed exploratory questions, update `docs/prd/system.md` and `.emb-agent/req.yaml`, run `validate` or `health` after truth edits, then stop until explicit agreement.
5. If `agent_protocol.gate.kind` is `prd-breakdown`, read `docs/prd/system.md`, present `prd_task_candidates`, create vertical child PRDs under `docs/prd/tasks`, `features`, `modules`, `components`, or `subsystems`, run `validate` or `health`, and wait for explicit agreement before `task add`, activation, scan, plan, or implementation.
6. If `agent_protocol.gate.kind` is `alignment`, stop after PRD/task creation, ask the user about unclear items, update the PRD/task truth, and repeat until explicit agreement before activation, planning, or implementation.
7. If `agent_protocol.gate.kind` is `execution`, treat the payload as an execution brief: perform the requested repository change now, then verify after implementation evidence exists.
8. If the user embeds an unconfirmed technical choice, route through `decision review` / `decision record` before implementation instead of silently validating the premise.
9. Avoid showing raw JSON, full command transcripts, or long `node .../emb-agent.cjs ...` paths unless explicitly requested.
10. Keep direct CLI/human-readable output available for debugging and automation only.

## PRD exploration gate

Before a system PRD can be confirmed, `agent_protocol.gate.kind = "prd-exploration"` means the host should run a doc-grounded requirement exploration loop first. If `document_evidence_policy.hardware_first=true`, the host must scan and ingest the listed schematics, datasheets, and manuals before asking the first behavior question; PDF/manual parsing should use the configured local tool order before MinerU fallback. The host should ask what behavior, interactions, defaults, abnormal cases, power/reset behavior, constraints, and acceptance evidence the user actually wants; mark schematic/manual inference separately from confirmed facts; update `docs/prd/system.md`; mirror structured truth into `.emb-agent/req.yaml`; and stop until explicit user agreement. Child execution PRDs are created only after the later `prd-breakdown` gate asks for system-PRD breakdown.

## PRD breakdown gate

After a substantive system PRD exists but no child execution PRDs or open tasks exist, `agent_protocol.gate.kind = "prd-breakdown"` means the host should not ask the user for a blank new task. It must read `docs/prd/system.md`, present the runtime's `prd_task_candidates`, create vertical child PRDs, run `validate` or `health` after edits, and stop for explicit user agreement before task creation or activation.

## Alignment gate

After a PRD or task is created, `agent_protocol.gate.kind = "alignment"` means the host should not immediately activate, scan, plan, implement, verify, or close. The host should summarize only the unclear goal/scope/constraint/acceptance points, ask the user to confirm or correct them, update the PRD/task artifact with the agreed truth, and repeat until the user explicitly agrees.

## Execution gate

`capability run do --brief` may return an execution brief instead of direct mutations. In AI-host mode this means emb-agent has opened the workflow gate and supplied constraints; the host AI must do the actual edit/write/test work. The host must not jump straight to `verify`, mark the task done, or tell the human implementation completed until it has either changed the repository or recorded an explicit no-op rationale.

## Decision review gate

Use `decision review` when implementation depends on an unconfirmed architecture, framework, protocol, concurrency, hardware, or resource-ownership choice. A blocking decision gate means the host should explain the missing review in concise Chinese and stop until the choice, alternatives, rejected options, and evidence are recorded with `decision record`.

## Default UX

For host integrations such as Pi, Codex, Claude, and Cursor:

```text
emb-agent command -> hidden/AI context -> AI Chinese summary -> human
```

Not:

```text
emb-agent command -> raw JSON or command transcript -> human
```
