---
name: swarm-execution
description: Run a flat peer-style execution plan through the host sub-agent bridge.
when_to_use: Use when the task genuinely benefits from multiple independent peers working in parallel and the host bridge can launch real sub-agents.
allowed_tools:
  - spawn_agent
  - review
execution_mode: isolated
---

# swarm-execution

Use this skill when the work should be split into a flat peer roster rather than a single coordinator chain.

## Rules

- Keep the roster flat. Peers do not recruit more peers.
- Share only the task board, not hidden conversational state.
- Let the main thread integrate all peer results back into standard emb output.

## Expected Output

- Peer roster with explicit ownership
- Shared task board or checkpoints
- Integration notes for the main thread
