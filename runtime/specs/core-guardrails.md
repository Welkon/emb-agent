# Emb Core Guardrails

- Update `./.emb-agent/hw.yaml` and `./.emb-agent/req.yaml` before relying on inferred hardware or requirement facts.
- Keep unknowns explicit. If a hardware truth, requirement, or datasheet detail is still missing, record the gap instead of guessing.
- Prefer the smallest change that closes the current task. Do not widen scope unless the current task is blocked by it.
- Reuse current repo structure first. Treat new abstractions, new files, and new subsystems as opt-in, not default.
- Verify before claiming closure. Name the concrete command, bench step, or evidence path that proves the result.

