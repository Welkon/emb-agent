# Baremetal 8-bit Focus

- Protect ISR latency and shared-state integrity before considering stylistic refactors.
- Prefer direct, readable state transitions over layered abstractions unless reuse pressure is already proven.
- Re-check ROM, RAM, stack, and pin-mux consequences whenever control flow or peripheral usage changes.
- Treat register assumptions as unsafe until they are backed by board truth, code evidence, or adapter/tool output.

