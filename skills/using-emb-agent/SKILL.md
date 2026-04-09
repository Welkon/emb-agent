---
name: using-emb-agent
description: Use when starting an embedded development conversation or when the user asks for bring-up, datasheet analysis, register reasoning, tool calculation, adapter generation, or architecture review. Route to the lightest emb-agent path first.
---

# using-emb-agent

You are using emb-agent.

- Identify what class of problem this is first.
- Prefer the lightest, closest-to-truth path first.
- Do not promote work into heavy planning by default.
- If a tool is already executable, run the tool before discussing implementation.

## Routing Order

1. If the project is not initialized, start with `init`.
2. If MCU truth, package, board wiring, or requirements are missing, fill in `hw.yaml / req.yaml` first.
3. If the issue is mainly about registers, pin muxing, timing constraints, or threshold definitions, check whether manual-grounded truth already exists. If not, start with `ingest doc`.
4. After `ingest doc`, prefer `doc diff/apply` so facts land in `hw.yaml / req.yaml` before implementation or calculation.
5. If the issue is fundamentally a timer / PWM / ADC / comparator / LVDC / charging-parameter calculation, inspect `next.tool_recommendation` first.
6. If `tool_execution.status = ready`, run `tool run ...` first.
7. If a tool is missing inputs, fill `missing_inputs` instead of guessing an implementation.
8. If adapters are missing, prefer `adapter bootstrap / sync / derive`.
9. If the task is really about system-level risk, selection, or RTOS/IoT architecture pressure, use `arch-review` or `review`.
10. Use lightweight `plan / debug / verify` only when the task is clearly complex, multi-step, or risk-heavy.

## Default Principles

- Truth comes before guesses.
- Manual-grounded truth comes before habitual code assumptions.
- Tool results come before empty discussion.
- If adapter trust is weak, do not treat the result as direct ground truth.
- Before clear-context risk becomes high, remind the user to run `pause`.
- After clearing context, reconnect the main line through `resume`, workspace, task, spec, or thread first.

## Fast Mapping

- Chip / package / pin / peripheral differences
  Use `adapter`, `tool`, `ingest doc`.
- Board bring-up, peripheral anomalies, or unexpected register behavior
  Use `scan`, `debug`, `tool run`, `forensics`.
- Long-lived work surfaces or cross-session topics
  Use `workspace`, `task`, `thread`, `spec`.
- Complex system review, selection, or production risk
  Use `arch-review`, `review`.

## Prohibitions

- Do not start heavy planning just to appear rigorous.
- Do not skip runnable tools and jump into speculation.
- Do not ignore `adapter_health`, `quality_overview`, or `recommended_action`.
- Do not treat a derived draft adapter as final ground truth.
