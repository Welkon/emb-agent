# Rust Spike

This branch contains an additive Rust prototype for the emb-agent runtime.

## Goals

- Reduce repeated Node.js process startup overhead for lightweight hooks.
- Explore a stricter systems-language core for project state, hook payloads, and future embedded tooling.
- Keep the existing Node runtime as the source of truth until Rust reaches parity.

## Current Scope

The prototype lives in `crates/emb-agent-rs` and provides:

```bash
cargo run -p emb-agent-rs -- start --brief --json --cwd .
cargo run -p emb-agent-rs -- statusline --cwd .
cargo run -p emb-agent-rs -- hook session-start --cwd . --host pi
cargo run -p emb-agent-rs -- hook statusline --cwd .
```

It currently reads only lightweight `.emb-agent/` project state:

- `.emb-agent/project.json`
- `.emb-agent/hw.yaml`
- `.emb-agent/.developer`
- `.emb-agent/.current-task`
- `.emb-agent/tasks/*/task.json`
- `.emb-agent/wiki/**/*.md`

## Non-goals

- It does not replace `runtime/bin/emb-agent.cjs`.
- It does not mutate repository state.
- It does not implement the full workflow, knowledge graph, plugin, or skill runtime.

## Validation

```bash
cargo fmt --check
cargo test --workspace
```
