# Rust Parity Gap

This document records the known behavior gap between the existing Node runtime and the additive Rust spike on the `beta` branch.

The Rust prototype is intentionally lightweight. It is a fast hook/runtime substrate experiment, not a full replacement for the Node implementation.

## Summary

| Surface                | Node runtime                                                                                                                                                | Rust spike                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `statusline`           | Full statusline: branch, session checkpoint, knowledge graph freshness, wiki count, package, duration, developer, open tasks, active task                   | Lightweight statusline: chip, task count, wiki count, branch, next command, active task                                          |
| `session-start`        | Full startup context: bootstrap, resume/handoff, active task context, update notices, workflow specs, workflow state, knowledge graph/wiki/cache highlights | Minimal startup context: project root, recommended command, developer, MCU, package, open tasks, wiki pages, branch, active task |
| `context-monitor`      | Node hook monitors live metrics, session hygiene, debounce state, and stale graph refresh after tool use                                                     | Minimal Rust hook handles trust signals, live context metrics/session hygiene payloads, and duplicate warning suppression         |
| `start --brief --json` | Full workflow-aware start payload                                                                                                                           | Minimal project-state payload                                                                                                    |
| project init/bootstrap | Full Node implementation                                                                                                                                    | Not implemented                                                                                                                  |
| task commands          | Full Node implementation                                                                                                                                    | Read-only task snapshot only                                                                                                     |
| knowledge graph        | Build/read/refresh/report                                                                                                                                   | Not implemented                                                                                                                  |
| skills/plugins         | Full discovery/install/run implementation                                                                                                                   | Not implemented                                                                                                                  |
| sub-agent bridge       | Full bridge/job implementation                                                                                                                              | Not implemented                                                                                                                  |
| file mutations         | Node workflow commands may write                                                                                                                            | Rust spike does not mutate project files; context monitor may write temp debounce state                                           |
| hook resolver          | Host-specific install helpers build commands directly                                                                                                       | `emb-agent-rs hook resolve --json` emits a unified hook plan for consumers                                                       |

## Intentional differences

### Minimal startup context

The Rust `hook session-start` output is intentionally smaller than Node's output. It is designed to validate:

- startup latency reduction,
- PI-compatible hook payload shape,
- project-root discovery,
- lightweight project facts.

It should not yet be used as a semantic replacement when the main thread needs full workflow guidance, graph freshness, or task intake logic.

### Statusline vocabulary

The Rust statusline uses an explicit `emb-rs` prefix so developers can tell which hook path is active.

Example:

```text
emb-rs · chip: ESP32-C3 QFN32 · 1 task(s) · branch: beta · next: do | [P1] Exercise ADC path
```

### Source-layout default only

The Pi extension defaults to Rust hooks only when it detects a source/development runtime layout:

```text
runtime/../Cargo.toml exists
```

Installed package runtimes continue to use Node hooks by default unless forced by:

```bash
EMB_AGENT_RUST_HOOKS=1
```

## Required before replacing Node hooks by default

Before Rust can become the default for installed users, it needs at least:

1. Build/release pipeline for distributing `emb-agent-rs` binaries.
2. Installer support for choosing Rust hooks explicitly.
3. More complete statusline parity, especially graph/session checkpoint semantics.
4. Fuller Rust context-monitor parity for graph freshness and Node status-derived context hygiene.
5. Documented fallback and diagnostics when Rust binary is missing.
6. Cross-platform verification on Windows, macOS, Linux, and WSL.

## Current validation commands

```bash
npm run dev:rust-hooks
npm run test:rust
node tests/pi-extension-rust-hooks.test.cjs
EMB_BENCH_ITER=50 npm run bench:rust-hook
```
