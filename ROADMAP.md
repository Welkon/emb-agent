# Roadmap

The current priority is stability rather than width of features. Recent work has focused on keeping the Codex installation chain, runtime behavior, truth-layer flow, lightweight orchestration, and verification/reporting commands stable.

## Current Direction

- Keep command flow lightweight by default.
- Prefer `scan -> do` for simple tasks.
- Use `plan` only as a task-level micro-plan for genuinely complex work.
- Keep review, verification, and note persistence lightweight and durable.
- Strengthen structured signals such as tool trust, executor summaries, and context-hygiene guidance.

## Non-Goals

- No heavy phase planning by default.
- No large planner/checker multi-agent chains by default.
- No hidden project-private runtime layer.
- No broad knowledge-base system inside core.

## Acceptance Lens

Every roadmap item should improve one of these outcomes without making the framework heavy:

- Stronger truth-source handling.
- Better minimal next-step guidance.
- Better adapter trust and runnable tool paths.
- Better pause/resume and context hygiene.
- Better persistence of durable engineering conclusions.
