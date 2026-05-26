# Task: emb-agent status

Show emb-agent project status: chip, package, open tasks, wiki pages, and active task.

# Workflow
1. Run `node .cursor/emb-agent/bin/emb-agent.cjs status --brief`
2. Parse the JSON output
3. Summarize the project state concisely

# Output
- MCU package, open task count, wiki page count
- Active task (if any)
- Recommended next action
