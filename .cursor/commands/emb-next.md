# Task: emb-agent next

Run the emb-agent workflow router to determine the next step for this firmware project.

# Workflow
1. Run `node .cursor/emb-agent/bin/emb-agent.cjs next --brief`
2. Parse the JSON output — pay attention to `action`, `instructions`, `task_candidates`, and `agent_protocol.gate`
3. Present findings to the user:
   - If `task_candidates` are present: show task list and ask which to activate
   - If `agent_protocol.gate.kind` is `prd-exploration`: ask structured questions before PRD
   - If `agent_protocol.gate.kind` is `task-selection`: present candidate tasks
   - If `instructions` has action steps: follow them
4. Do NOT ask the user to run emb-agent commands manually — you run them

# Output
- Summarize the current project state
- Recommend and execute the next step
