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

- Keep guidance hardware-first and name the real blocker.
- Give the exact next command or file before adding extra structure.
- Treat skills, hooks, and wrappers as integration surfaces; they must not override emb-agent runtime gates.
- Avoid generic AI or project-management wording when a concrete board action, artifact, or truth file is known.

{{LANGUAGE_INSTRUCTION}}

## Local Codex Rules

- Structure may be templated, content may not.
- Ask the anti-template question before adding defaults.
- The template should remember harness infrastructure so the skill author can focus on project truth.
- Treat `agent_protocol.gate` fields from emb-agent JSON as authoritative; execute allowed host actions yourself and never ask the user to run emb-agent commands manually.
- Read `.emb-agent/config.yaml` when Codex dispatch behavior is relevant. `codex.dispatch_mode: inline` means the main Codex agent should do scoped edits directly; `sub-agent` means broad implement/check work may be delegated when Codex exposes a subagent tool.
- If the current request is a narrow explanation, one-off verification, or small scoped fix, keep the flow direct unless the scope clearly turns into resumable multi-step work.
