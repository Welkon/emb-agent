# Padauk Firmware Focus

- Treat Padauk work as a constrained-toolchain path, not as "generic C on a small MCU". Before introducing syntax sugar, helper layers, or indirection, verify that the real compiler and project dialect support it cleanly.
- Keep naming robust under case-insensitive tooling. Distinctions that only differ by letter case are unstable here; choose explicit English names that stay readable after code generation, map output, and review.
- Keep ISR paths minimal and review the main-loop handoff together with them. Latch the event, clear the interrupt source, and move decode or policy logic back into the foreground path unless measurement proves otherwise.
- For ROM/RAM regressions, inspect the map file, list output, or generated assembly before refactoring blindly. The right fix is usually the smallest direct state path, not another abstraction layer.
- Record Padauk or Simple-C specific syntax limits, naming rules, and known compiler traps in `docs/IMPLEMENTATION-STYLE.md` so the next task inherits the same constraints automatically.
