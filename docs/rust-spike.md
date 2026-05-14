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

## Pi Extension Hook Selection

In source/development runtime layout, the Pi extension now defaults lightweight hooks to Rust:

- `session_start` → `emb-agent-rs hook session-start --host pi`
- statusline → `emb-agent-rs hook statusline`

Fallback behavior:

- If `target/debug/emb-agent-rs` exists, the Pi extension uses the compiled binary.
- Otherwise, source layout falls back to `cargo run -q -p emb-agent-rs -- ...`.
- If Rust execution fails, the extension automatically falls back to the existing Node hook.
- Installed/non-source runtimes continue to use Node hooks by default.

Environment overrides:

```bash
EMB_AGENT_RUST_HOOKS=1   # force Rust hook path
EMB_AGENT_RUST_HOOKS=0   # force Node hook path
EMB_AGENT_RUST_HOOK_CMD="/path/to/emb-agent-rs"  # custom Rust hook command
```

`emb-context-monitor.js` is still Node-only in this spike.

## Non-goals

- It does not replace `runtime/bin/emb-agent.cjs`.
- It does not mutate repository state.
- It does not implement the full workflow, knowledge graph, plugin, or skill runtime.

## Validation

```bash
cargo fmt --check
cargo test --workspace
node tests/rust-parity.test.cjs
npm run test:rust
```

## Benchmark

```bash
npm run bench:rust-hook
# or change sample size
EMB_BENCH_ITER=50 npm run bench:rust-hook
```

The benchmark compares:

- Node `runtime/hooks/emb-statusline.js`
- `cargo run -p emb-agent-rs -- hook statusline`
- compiled `target/debug/emb-agent-rs hook statusline`
