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
      "kind": "prd-confirmation",
      "blocking": true,
      "allowed_actions": ["prd status", "prd confirm --create-tasks"],
      "forbidden_actions": ["scan", "plan", "do"]
    },
    "recommendation": {
      "command": "prd confirm --create-tasks"
    },
    "ai_instruction": {
      "ask_user": "请确认当前 docs/prd 是否可以作为实现基线。",
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
4. If the user embeds an unconfirmed technical choice, route through `decision review` / `decision record` before implementation instead of silently validating the premise.
5. Avoid showing raw JSON, full command transcripts, or long `node .../emb-agent.cjs ...` paths unless explicitly requested.
6. Keep direct CLI/human-readable output available for debugging and automation only.

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
