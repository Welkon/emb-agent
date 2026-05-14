# Rust Spike

This branch contains an additive Rust prototype for the emb-agent runtime.

## Goals

- Reduce repeated Node.js process startup overhead for lightweight hooks.
- Explore a stricter systems-language core for project state, hook payloads, and future embedded tooling.
- Keep the existing Node runtime as the source of truth until Rust reaches parity.

## Development Flow

Build the Rust hook binary before using Pi in this source checkout:

```bash
npm run dev:rust-hooks
```

This creates `target/debug/emb-agent-rs`. Source-layout hook plans point at that binary and fall back to Node if it is missing or fails.

Recommended loop:

```bash
npm run dev:rust-hooks
npm run test:rust
node tests/pi-extension-rust-hooks.test.cjs
node tests/rust-hook-install-source-layout.test.cjs
EMB_BENCH_ITER=50 npm run bench:rust-hook
```

For current behavior gaps, see [`rust-parity-gap.md`](./rust-parity-gap.md).

## Current Layout

The Rust spike is now split into:

```text
crates/emb-agent-core/   # shared hook plans, project snapshots, rendering helpers
crates/emb-agent-rs/     # CLI routing binary
```

`emb-agent-core` is the first shared crate. It currently contains `hooks`, `context_monitor`, `project`, `render`, and `json` modules. New durable runtime logic should move there or into future focused crates instead of growing the binary crate.

## Current Scope

The prototype CLI lives in `crates/emb-agent-rs` and provides:

```bash
cargo run -p emb-agent-rs -- start --brief --json --cwd .
cargo run -p emb-agent-rs -- statusline --cwd .
cargo run -p emb-agent-rs -- hook resolve --host pi --hook session-start --runtime-dir runtime --json
cargo run -p emb-agent-rs -- diagnostics hooks --json --host pi --runtime-dir runtime
cargo run -p emb-agent-rs -- hook session-start --cwd . --host pi
cargo run -p emb-agent-rs -- hook statusline --cwd .
printf '{"cwd":".","workspace_trusted":true,"context_window":{"remaining_percentage":18}}' \
  | cargo run -p emb-agent-rs -- hook context-monitor
```

It currently reads only lightweight `.emb-agent/` project state:

- `.emb-agent/project.json`
- `.emb-agent/hw.yaml`
- `.emb-agent/.developer`
- `.emb-agent/.current-task`
- `.emb-agent/tasks/*/task.json`
- `.emb-agent/wiki/**/*.md`

## Hook Resolver

Rust is the source of truth for new hook command planning:

```bash
cargo run -p emb-agent-rs -- hook resolve --host pi --hook session-start --runtime-dir runtime --json
cargo run -p emb-agent-rs -- hook resolve --host cursor --hook context-monitor --runtime-dir runtime --json
```

Example source-layout session-start plan:

```json
{
  "hook": "session-start",
  "host": "pi",
  "runtime": "rust",
  "command": "target/debug/emb-agent-rs hook session-start --host pi",
  "fallback": "node runtime/hooks/emb-session-start.js",
  "reason": "source-runtime-default",
  "supported": true
}
```

`context-monitor` now resolves to Rust in source layouts. It is a minimal metrics/session-hygiene implementation and still falls back to the Node hook in generated plans.

## Hook Diagnostics

Use diagnostics to inspect all hook plans at once:

```bash
cargo run -p emb-agent-rs -- diagnostics hooks --json --host pi --runtime-dir runtime
```

The payload includes:

- selected host,
- runtime directory,
- source-runtime detection,
- Rust binary path and existence,
- resolver-related environment variables,
- plans for `session_start`, `statusline`, and `context_monitor`.

## Host Hook Selection

The installer asks the Rust resolver for lightweight hook plans, then hosts consume those plans:

- `session_start` → `emb-agent-rs hook session-start --host <host>` when Rust is selected
- statusline → `emb-agent-rs hook statusline` when Rust is selected
- `context-monitor` → `emb-agent-rs hook context-monitor` when Rust is selected

Fallback behavior:

- Source-layout plans point at `target/debug/emb-agent-rs` for Rust-supported hooks.
- If Rust execution fails, Pi extension falls back to the existing Node hook command from the plan.
- Installed/non-source runtimes continue to use Node hooks by default.

Resolver environment overrides, evaluated when hook plans are generated:

```bash
EMB_AGENT_RUST_HOOKS=1   # force Rust hook path
EMB_AGENT_RUST_HOOKS=0   # force Node hook path
EMB_AGENT_RUST_HOOK_CMD="/path/to/emb-agent-rs"  # custom Rust hook command
```

`emb-context-monitor.js` remains the Node fallback and still has fuller graph/session behavior than the minimal Rust implementation.

## Non-goals

- It does not replace `runtime/bin/emb-agent.cjs`.
- It does not mutate repository state.
- It does not implement the full workflow, knowledge graph, plugin, or skill runtime.

## Validation

```bash
cargo fmt --check
npm run dev:rust-hooks
npm run test:rust
node tests/pi-extension-rust-hooks.test.cjs
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
