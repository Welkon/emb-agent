# emb-agent Rust Migration Plan

This document is the full migration plan for moving emb-agent from the current Node/CJS runtime to a Rust-first runtime.

The migration uses a strangler-fig strategy: Rust gradually becomes the source of truth while Node remains a compatibility shell and fallback until parity is proven.

## Executive Summary

### End state

```text
emb-agent = Rust binary + templates + thin npm/host wrappers
```

Node remains only for:

- npm package bootstrap/wrapper,
- compatibility entrypoints during transition,
- host surfaces that require TypeScript/JavaScript, such as Pi extensions.

All durable product logic should move to Rust.

### Migration principle

Do not add new core product logic to CJS unless it is a temporary bridge. New durable logic should live in Rust.

### Current beta state

Already done on `beta`:

- `emb_sidequest` Pi tool and `/emb:sidequest` command.
- Rust workspace with `crates/emb-agent-core` plus the `crates/emb-agent-rs` CLI spike.
- Core hook planning, project snapshot, JSON helper, and rendering modules live in `emb-agent-core`.
- Rust lightweight `start`, `statusline`, `hook session-start`, `hook statusline`, and minimal `hook context-monitor`.
- Rust `hook resolve --json` command plan.
- Pi extension consumes installer-provided hook plans.
- Installer can consume Rust hook resolver plans and fallback to Node.
- Rust tests, parity tests, and hook benchmark exist.

Known benchmark:

```text
Node statusline hook          ~100 ms median
Rust binary statusline        ~10 ms median
```

## Non-negotiable Migration Rules

1. **No big-bang rewrite.** Every phase must be independently shippable.
2. **Rust first for new runtime logic.** CJS only for compatibility/fallback.
3. **Node fallback remains until parity is proven.** Users must not be stranded.
4. **Every Rust replacement needs parity tests.** Behavioral compatibility beats visual similarity.
5. **Feature flags before defaults.** Default changes only after benchmark + parity evidence.
6. **Host-specific TypeScript stays TypeScript.** Pi extension remains TS, but consumes Rust-generated plans.
7. **No hidden file mutations.** Rust write paths must have explicit contracts and tests.
8. **Cross-platform from the start.** Linux, macOS, Windows, WSL paths must be considered.

## Target Architecture

### Workspace layout

Long-term Rust layout:

```text
crates/
  emb-agent-core/          # shared types, project model, errors, JSON/YAML helpers
  emb-agent-cli/           # final CLI binary entrypoint
  emb-agent-hooks/         # session-start/statusline/context-monitor
  emb-agent-host/          # Pi/Codex/Cursor/Claude install + hook command plans
  emb-agent-workflow/      # start/next/scan/plan/do/review/verify state machine
  emb-agent-task/          # task lifecycle, PRD/task artifacts, worktree metadata
  emb-agent-knowledge/     # graph/wiki/cache/document state
  emb-agent-skills/        # skills/plugins discovery, install, run
  emb-agent-tools/         # calculators, chip/tool registry, generated adapters
  emb-agent-subagent/      # dispatch contracts, worker jobs, bridges
  emb-agent-docs/          # doc/schematic ingestion abstractions
  emb-agent-rs/            # temporary spike binary; later replaced by emb-agent-cli
```

During migration, `crates/emb-agent-rs` should remain a thin routing binary. Durable runtime modules should move into `emb-agent-core` first, then into dedicated crates when boundaries are clear.

### Final command surface

```bash
emb-agent start [--brief] [--json]
emb-agent next [--brief] [--json]
emb-agent scan|plan|do|debug|review|verify
emb-agent task ...
emb-agent knowledge ...
emb-agent skills ...
emb-agent tools ...
emb-agent hook session-start --host pi|codex|cursor|claude
emb-agent hook statusline
emb-agent hook context-monitor
emb-agent hook resolve --host pi --hook session-start --json
emb-agent host install --host pi --local
emb-agent host uninstall --host pi --local
```

### Node compatibility shell

Short-term:

```text
runtime/bin/emb-agent.cjs  -> calls existing CJS runtime
bin/install.js             -> existing npm installer
```

Mid-term:

```text
runtime/bin/emb-agent.cjs  -> forwards selected commands to Rust, fallback to CJS
bin/install.js             -> locates/downloads/calls Rust binary, fallback to JS installer
```

End-state:

```text
runtime/bin/emb-agent.cjs  -> thin compatibility wrapper around Rust binary
bin/install.js             -> npm bootstrap only
```

## Phase Plan

## Phase 0 — Rust Spike and Hook Resolver

Status: mostly done on `beta`.

### Scope

- Rust workspace exists.
- Rust reads lightweight `.emb-agent/` state.
- Rust implements:
  - `start --brief --json`,
  - `statusline`,
  - `hook session-start`,
  - `hook statusline`,
  - `hook resolve --json`.
- Pi extension consumes hook plans.
- Installer can query Rust hook resolver with Node fallback.

### Acceptance

```bash
cargo fmt --check
npm run test:rust
node tests/pi-extension-rust-hooks.test.cjs
node tests/install.test.cjs
EMB_BENCH_ITER=50 npm run bench:rust-hook
```

### Exit criteria

- Rust statusline is consistently ~10x faster than Node hook.
- Hook resolver JSON is stable enough for host consumers.
- No production install defaults broken.

## Phase 1 — Rust Hook Runtime Parity

Goal: Replace all lightweight host hooks with Rust-backed implementations, while keeping Node fallback.

### Scope

1. Implement Rust `hook context-monitor`.
2. Move hook payload normalization into Rust.
3. Emit host-specific payloads for:
   - Pi,
   - Codex,
   - Cursor,
   - Claude.
4. Expand `hook resolve` for all hook types:
   - `session-start`,
   - `statusline`,
   - `context-monitor`.
5. Installer consumes Rust plan for all supported hooks.
6. Pi extension consumes injected plans only; no embedded resolver logic.

### Key files to migrate

```text
runtime/hooks/emb-session-start.js
runtime/hooks/emb-statusline.js
runtime/hooks/emb-context-monitor.js
runtime/lib/hook-dispatch.cjs
runtime/lib/hook-trust.cjs
runtime/lib/context-protocol-runtime.cjs
runtime/lib/runtime-events.cjs
```

### Rust modules

```text
emb-agent-hooks::session_start
emb-agent-hooks::statusline
emb-agent-hooks::context_monitor
emb-agent-host::hook_plan
emb-agent-host::payload
```

### Tests

- Existing Node hook tests become parity tests.
- Add Rust-first hook tests:

```text
tests/rust-session-start-parity.test.cjs
tests/rust-statusline-parity.test.cjs
tests/rust-context-monitor-parity.test.cjs
```

### Acceptance

- `EMB_AGENT_RUST_HOOKS=1` passes all hook tests.
- `EMB_AGENT_RUST_HOOKS=0` keeps Node behavior.
- Missing Rust binary falls back to Node with no crash.
- Hook benchmark remains favorable.

### Rollback

Set:

```bash
EMB_AGENT_RUST_HOOKS=0
```

or install without Rust binary.

## Phase 2 — Rust Core Project State

Goal: Rust owns project discovery and `.emb-agent/` state IO.

### Scope

Move project state primitives to Rust:

- project root discovery,
- `.emb-agent/project.json`,
- `.emb-agent/hw.yaml`,
- `.emb-agent/req.yaml`,
- `.emb-agent/.developer`,
- `.emb-agent/.current-task`,
- runtime state paths,
- local vs global state roots,
- fallback state storage.

### Key CJS files

```text
runtime/lib/runtime.cjs
runtime/lib/project-config.cjs
runtime/lib/project-state-store.cjs
runtime/lib/project-input-state.cjs
runtime/lib/project-input-intake.cjs
runtime/lib/hardware-truth.cjs
runtime/lib/workflow-state.cjs
```

### Rust modules

```text
emb-agent-core::project_root
emb-agent-core::project_config
emb-agent-core::state_paths
emb-agent-core::hardware
emb-agent-core::requirements
emb-agent-core::yaml
```

### Data model requirements

Use typed structs for:

```rust
ProjectConfig
HardwareTruth
Requirements
SessionState
TaskRef
RuntimeEvent
```

### Tests

- Golden fixtures for `.emb-agent/` layouts.
- Round-trip JSON/YAML tests.
- Windows path tests.
- Fallback state path tests.

### Acceptance

- Rust and Node produce equivalent project/session summaries.
- Rust can read existing projects without migration.
- No schema-breaking changes.

## Phase 3 — Rust `start`, `status`, and `next`

Goal: Move primary routing/context commands to Rust.

### Scope

Implement Rust versions of:

```bash
emb-agent start --brief --json
emb-agent external status
emb-agent external health
emb-agent next --brief --json
```

`start` and `next` are high-leverage because all hosts call them.

### Key CJS files

```text
runtime/lib/emb-agent-main.cjs
runtime/lib/cli-router.cjs
runtime/lib/cli-entrypoints.cjs
runtime/lib/session-flow.cjs
runtime/lib/external-agent.cjs
runtime/lib/core-protocols.cjs
runtime/lib/output-mode.cjs
runtime/lib/intent-analyzer.cjs
runtime/lib/intent-provider.cjs
runtime/lib/knowledge-followups.cjs
```

### Rust modules

```text
emb-agent-cli::router
emb-agent-workflow::start
emb-agent-workflow::next
emb-agent-workflow::health
emb-agent-protocol::external
emb-agent-protocol::agent_protocol
```

### Compatibility rule

Rust output must preserve machine-readable protocol fields consumed by hosts:

```text
agent_protocol
runtime_events
summary
immediate
next
gate
recommended_flow
```

### Tests

- Golden JSON fixtures for `start --brief --json` and `next --brief --json`.
- Host message protocol tests.
- Existing `brief-mode`, `next-source-intake`, `external-driver` parity tests.

### Acceptance

- Hosts can use Rust `start/next` by default in source layout.
- Node fallback remains for all unsupported subcommands.

## Phase 4 — Rust Task and Workflow Runtime

Goal: Move task lifecycle and workflow actions to Rust.

### Scope

Implement:

```bash
emb-agent task add|list|show|activate|context|worktree|close
emb-agent scan
emb-agent plan
emb-agent do
emb-agent debug
emb-agent review
emb-agent verify
```

At this phase Rust starts writing files, so write contracts become critical.

### Key CJS files

```text
runtime/lib/task-commands.cjs
runtime/lib/action-contracts.cjs
runtime/lib/dispatch-command-runtime.cjs
runtime/lib/dispatch-orchestrator.cjs
runtime/lib/executor-command.cjs
runtime/lib/decision-command.cjs
runtime/lib/prd-command.cjs
runtime/lib/quality-gates.cjs
runtime/lib/review-save.cjs
runtime/lib/scan-save.cjs
runtime/lib/verify-save.cjs
runtime/lib/scheduler.cjs
```

### Rust modules

```text
emb-agent-task::manifest
emb-agent-task::prd
emb-agent-task::context
emb-agent-workflow::actions
emb-agent-workflow::quality_gates
emb-agent-workflow::scheduler
```

### Write safety requirements

Every write command must define:

```text
Inputs
Outputs
Forbidden zones
Idempotency expectations
Rollback behavior
```

### Tests

- Golden task directory fixtures.
- Idempotent rerun tests.
- Write-permission tests.
- Worktree safety tests.
- End-to-end task lifecycle tests.

### Acceptance

- Rust can create and activate tasks.
- Rust can close task flow with review/verify artifacts.
- Existing Node task tests pass against Rust path.

## Phase 5 — Rust Knowledge Graph, Wiki, and Cache

Goal: Move persistent knowledge and graph state to Rust.

### Scope

Implement:

```bash
emb-agent knowledge graph build|refresh|status|query
emb-agent wiki update/stub helpers
emb-agent cache docs/schematics status
```

### Key CJS files

```text
runtime/lib/knowledge-runtime.cjs
runtime/lib/knowledge-graph-state.cjs
runtime/lib/knowledge-followups.cjs
runtime/lib/doc-cache.cjs
runtime/lib/note-reports.cjs
runtime/lib/note-report-runtime.cjs
runtime/lib/memory-runtime.cjs
```

### Rust modules

```text
emb-agent-knowledge::graph
emb-agent-knowledge::wiki
emb-agent-knowledge::cache
emb-agent-knowledge::notes
```

### Important design choice

Use a typed graph model early. Avoid porting ad-hoc JS maps directly.

Potential crates:

```text
serde
serde_json
serde_yaml
petgraph
ignore/walkdir
```

### Tests

- Graph fixture parity tests.
- Stale detection tests.
- Wiki page count/update tests.
- Cache report tests.

### Acceptance

- Rust can build graph for existing projects.
- Graph report stable enough for session-start context.
- Knowledge freshness no longer depends on Node.

## Phase 6 — Rust Chip Tools and Hardware Runtime

Goal: Move hardware truth, formula calculators, adapters, and chip/tool registries to Rust.

### Scope

Implement:

```bash
emb-agent tools list|run
emb-agent capability route/run
emb-agent chip support/status/analyze
emb-agent pin check
```

### Key CJS files

```text
runtime/lib/tool-runtime.cjs
runtime/lib/tool-catalog.cjs
runtime/lib/generated-tool-adapters.cjs
runtime/lib/capability-catalog.cjs
runtime/lib/capability-router.cjs
runtime/lib/capability-runtime.cjs
runtime/lib/chip-catalog.cjs
runtime/lib/chip-support-status.cjs
runtime/lib/pin-checker.cjs
runtime/lib/adapter-*.cjs
```

### Rust modules

```text
emb-agent-tools::catalog
emb-agent-tools::calculators
emb-agent-tools::capability
emb-agent-hardware::pins
emb-agent-hardware::chip_profiles
emb-agent-hardware::registers
```

### Future embedded ecosystem leverage

At this phase Rust can start integrating with:

```text
probe-rs
svd-parser
object/goblin for ELF
serialport
embedded-hal abstractions where useful
```

### Tests

- Calculator parity tests.
- Pin conflict fixtures.
- Chip profile schema tests.
- Capability router tests.

### Acceptance

- Rust can execute existing formulas/tools.
- Rust can validate pins and chip support state.
- Generated adapters have a Rust-compatible representation.

## Phase 7 — Rust Skills, Plugins, and Host Install

Goal: Move installer, skills, plugins, and host integration planning to Rust.

### Scope

Implement:

```bash
emb-agent host install --host pi|codex|cursor|claude --local|--global
emb-agent host uninstall ...
emb-agent skills list|run|install|remove
emb-agent plugin install|remove|list
```

### Key CJS files

```text
bin/install.js
runtime/lib/install-helpers.cjs
runtime/lib/install-targets.cjs
runtime/lib/skill-runtime.cjs
runtime/lib/default-skill-source.cjs
runtime/lib/default-adapter-source.cjs
runtime/lib/workflow-import.cjs
runtime/lib/workflow-registry.cjs
```

### Rust modules

```text
emb-agent-host::install
emb-agent-host::targets
emb-agent-host::templates
emb-agent-skills::discover
emb-agent-skills::plugins
emb-agent-skills::runtime
```

### Distribution constraint

Pi extension remains generated TypeScript:

```text
runtime/templates/pi-extension.ts.tpl
```

Rust owns template rendering and injects hook plans.

### Tests

- Installer parity tests for all supported hosts.
- Uninstall preservation tests.
- Template rendering tests.
- Skills/plugin fixtures.

### Acceptance

- Rust can install local/global host integrations.
- Node installer becomes wrapper/fallback.
- npm package can invoke Rust binary for installation.

## Phase 8 — Rust Sub-Agent, Sidequest, and Dispatch Runtime

Goal: Move orchestration/sub-agent contracts and sidequest planning to Rust.

### Scope

Implement:

```bash
emb-agent dispatch next|run
emb-agent subagent launch/collect
emb-agent sidequest plan/run
```

### Key CJS/TS files

```text
runtime/lib/sub-agent-runtime.cjs
runtime/lib/dispatch-orchestrator.cjs
runtime/lib/dispatch-command-runtime.cjs
runtime/lib/agent-protocol.cjs
runtime/bin/emb-codex-subagent-bridge.cjs
runtime/templates/pi-extension.ts.tpl
```

### Rust modules

```text
emb-agent-subagent::contract
emb-agent-subagent::bridge
emb-agent-subagent::jobs
emb-agent-subagent::synthesis
emb-agent-sidequest::plan
```

### Host behavior

- Pi sidequest remains implemented through Pi extension API, but Rust should produce sidequest prompt/plan.
- Codex/Cursor/Claude can consume the same dispatch/sidequest contracts.

### Tests

- Sub-agent bridge fixture tests.
- Manual-worker fallback tests.
- Sidequest prompt language tests.
- Job collection tests.

### Acceptance

- Rust owns dispatch contract synthesis.
- Host extensions only execute generated plans.
- Main-session pollution avoidance remains preserved.

## Phase 9 — Rust Document/Schematic/Board Ingestion

Goal: Move document ingestion orchestration and board/schematic parsers where appropriate.

### Scope

```bash
emb-agent ingest doc
emb-agent ingest schematic
emb-agent ingest board
emb-agent ingest truth
```

### Key CJS/Python files

```text
runtime/scripts/ingest-doc.cjs
runtime/scripts/ingest-schematic.cjs
runtime/scripts/ingest-board.cjs
runtime/lib/schdoc-parser.cjs
runtime/lib/altium-pcbdoc-parser.cjs
runtime/lib/board-evidence.cjs
runtime/lib/schematic-advisor.cjs
runtime/lib/board-advisor.cjs
emb-support/skills/altium-pcb/scripts/*.py
```

### Rust modules

```text
emb-agent-docs::ingest
emb-agent-docs::providers
emb-agent-board::schematic
emb-agent-board::pcb
emb-agent-board::evidence
```

### Strategy

Do not immediately rewrite complex Python Altium tooling if it already works. Rust should own orchestration and cache/state contracts first, then parsers can move later.

### Acceptance

- Rust can orchestrate doc/schematic ingestion.
- Existing provider behavior remains available.
- Cache layout remains compatible.

## Phase 10 — Release, Distribution, and Node Retirement

Goal: Ship Rust binary as the official runtime.

### Scope

- Build Rust binaries for:
  - linux x64/arm64,
  - macOS x64/arm64,
  - Windows x64,
  - WSL compatibility.
- npm package downloads or bundles correct binary.
- Node wrapper invokes Rust binary.
- CJS runtime marked deprecated.
- Unsupported commands fallback to Node only during grace period.

### Release assets

```text
emb-agent-linux-x64
emb-agent-linux-arm64
emb-agent-macos-x64
emb-agent-macos-arm64
emb-agent-windows-x64.exe
```

### npm package design

Option A: bundle all binaries.

Pros:

- Offline after npm install.
- Simple runtime.

Cons:

- Large package.

Option B: postinstall/download binary.

Pros:

- Smaller package.

Cons:

- Network/install complexity.
- Corporate proxy issues.

Recommended initial beta: bundle current-platform binary for local development; decide release distribution after CI prototype.

### Final acceptance

- `npx emb-agent` uses Rust installer.
- Host integrations call Rust by default.
- Node fallback remains available for one minor release.
- Full test suite passes in CI across platforms.

## Cross-Cutting Workstreams

## A. Schema and Protocol Stability

All machine protocol surfaces need explicit Rust structs and JSON snapshots:

```text
agent_protocol
runtime_events
hook payloads
start/next brief JSON
task manifest
workflow registry
knowledge graph
skill/plugin manifests
```

Use serde with deny-unknown-fields only where schemas are strict. For user/project files, prefer forward-compatible unknown-field preservation when possible.

## B. Error Model

Define a Rust error hierarchy:

```rust
EmbError
  Io
  Json
  Yaml
  Config
  ProjectNotFound
  PermissionDenied
  HookPlan
  UnsupportedCommand
  ExternalTool
```

CLI output rules:

- `--json` emits JSON errors.
- human mode emits concise stderr.
- hook mode must not dump noisy diagnostics into host context.

## C. Observability

Add structured diagnostics:

```bash
emb-agent diagnostics runtime
emb-agent diagnostics hooks
emb-agent diagnostics host
```

Rust should report:

- active runtime path,
- binary version,
- hook plan source,
- fallback reason,
- project root,
- state root,
- host target.

## D. Testing Strategy

Every migrated surface needs:

1. Rust unit tests.
2. Node-vs-Rust parity tests.
3. Golden JSON fixtures.
4. End-to-end tests when writes are involved.
5. Benchmark if performance was a migration motivation.

Suggested test layout:

```text
tests/rust-*.test.cjs              # parity/e2e from Node test runner
crates/*/src/**/*.rs               # Rust unit tests
fixtures/rust-parity/**            # golden project states
benchmarks/rust-*.cjs              # perf comparisons
```

## E. Feature Flags

During migration:

```bash
EMB_AGENT_RUST_HOOKS=1      # force Rust hooks
EMB_AGENT_RUST_HOOKS=0      # force Node hooks
EMB_AGENT_RUST_CLI=1        # future: force Rust command path
EMB_AGENT_RUST_INSTALL=1    # future: force Rust installer
```

Avoid many permanent flags. Flags should be transitional and documented with removal plans.

## F. Backward Compatibility

Rust must read existing `.emb-agent/` projects without migration.

If schema migration becomes necessary:

- add explicit `emb-agent migrate` command,
- write backup files,
- make migration idempotent,
- test old fixtures.

## G. Security and Trust

Installer and plugin migration must preserve trust boundaries:

- project-local extensions/skills are untrusted unless explicitly enabled,
- plugin install runs external code/deps and must be visible,
- path writes must stay inside declared project/runtime roots,
- no hidden recursive delegation.

## H. Performance Targets

Initial targets:

| Surface                        |                             Target |
| ------------------------------ | ---------------------------------: |
| statusline hook                |        <15 ms median compiled Rust |
| session-start lightweight hook | <30 ms median excluding graph work |
| `start --brief --json`         |      <50 ms on initialized project |
| `next --brief --json`          |      <80 ms on initialized project |
| hook resolve                   |               <10 ms compiled Rust |

## Detailed Milestone Table

| Phase | Name                | Default user impact   | Main output                   | Exit gate              |
| ----: | ------------------- | --------------------- | ----------------------------- | ---------------------- |
|     0 | Rust spike          | none                  | Rust lightweight hooks        | benchmark + tests      |
|     1 | Hook parity         | opt-in/source default | Rust all hooks                | hook parity tests      |
|     2 | Core state          | hidden                | typed project model           | state fixture parity   |
|     3 | start/next          | feature flag          | Rust routing context          | golden protocol parity |
|     4 | task/workflow       | feature flag          | Rust writes task artifacts    | write safety tests     |
|     5 | knowledge           | feature flag          | Rust graph/wiki/cache         | graph parity           |
|     6 | hardware tools      | feature flag          | Rust calculators/chip support | tool parity            |
|     7 | host install/skills | feature flag          | Rust installer                | install parity         |
|     8 | sub-agent/sidequest | feature flag          | Rust dispatch contracts       | bridge parity          |
|     9 | ingestion           | feature flag          | Rust ingestion orchestration  | cache/parser parity    |
|    10 | release             | default Rust          | Node wrapper only             | cross-platform CI      |

## Immediate Next Tasks

Recommended next tasks after this plan:

1. Expand Rust `context-monitor` parity for graph freshness and full status-derived context hygiene.
2. Add forced-Rust install coverage for any remaining host-specific hook surfaces.
3. Continue thinning `crates/emb-agent-rs`; introduce `emb-agent-cli` once the CLI routing boundary is stable.
4. Start typed project-state parity fixtures for `.emb-agent/project.json`, `hw.yaml`, `req.yaml`, and task refs.

## Stop Conditions

Pause Rust migration if any of the following happens:

- Rust implementation starts changing `.emb-agent/` file formats without migration plan.
- Parity tests become too broad and flaky.
- Host install breaks existing user config preservation.
- Binary distribution becomes unresolved after hooks/start/next are ready.
- Rust code starts copying CJS structure one-to-one without improving types or boundaries.

## Decision Log

| Decision                        | Current answer                                 |
| ------------------------------- | ---------------------------------------------- |
| Migration language              | Rust                                           |
| Strategy                        | incremental strangler fig                      |
| Node role                       | compatibility wrapper and fallback             |
| Pi extension language           | TypeScript, generated/controlled by Rust plans |
| Hook resolver source of truth   | Rust                                           |
| Installed package default today | Node fallback by default                       |
| Source checkout default today   | Rust lightweight hooks where planned           |
