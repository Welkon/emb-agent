# Codex Instructions

## Quick Routing

{{INCLUDE:_partials/quick-routing-table.md}}

## Auto Triggers

{{INCLUDE:_partials/auto-trigger-closure.md}}
- After context compression, prefer the injected emb-agent re-entry context. Re-open this file only if routing or host integration behavior is unclear.

When the user asks what an existing service split, scheduler path, or time-slice call chain means, explanation-first is a valid direct route. Do not force task creation just to answer that question.

## Red Flags - STOP

{{INCLUDE:_partials/red-flags-stop.md}}

## Human-Readable Defaults

{{INCLUDE:_partials/human-readable-defaults.md}}

{{LANGUAGE_INSTRUCTION}}

## Local Codex Rules

- Structure may be templated, content may not.
- Ask the anti-template question before adding defaults.
- The template should remember harness infrastructure so the skill author can focus on project truth.
- Treat `agent_protocol.gate` fields from emb-agent JSON as authoritative; execute allowed host actions yourself and never ask the user to run emb-agent commands manually.
- Read `.emb-agent/config.yaml` when Codex dispatch behavior is relevant. `codex.dispatch_mode: inline` means the main Codex agent should do scoped edits directly; `auto` recommends native Codex subagents for broad or high-risk work with inline fallback; `sub-agent` means implement/check work should be delegated when Codex exposes a subagent tool.
- For active task implementation on a subagent-capable Codex surface, prefer `fw-doer` followed by `release-checker`; child agents must treat delegation instructions as already satisfied and must not spawn more emb-agent subagents.
- If the current request is a narrow explanation, one-off verification, or small scoped fix, keep the flow direct unless the scope clearly turns into resumable multi-step work.
