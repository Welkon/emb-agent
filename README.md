<p align="center">
  <strong>A hardware-first AI workflow for embedded firmware projects</strong><br/>
  <sub>Keep MCU truth, pin usage, peripherals, constraints, and verification visible in the repo.</sub>
</p>

<p align="center">
  Codex • Claude Code • Cursor • Brownfield MCU repos • Register-heavy debugging • Datasheet-grounded work
</p>

<p align="center">
  <a href="./docs/README.md">Docs</a> •
  <a href="./docs/quick-start.md">Quick Start</a> •
  <a href="./docs/platforms.md">Platforms</a> •
  <a href="./docs/scenarios.md">Scenarios</a> •
  <a href="./docs/product-boundaries.md">Product Boundaries</a> •
  <a href="./docs/adapter-model.md">Adapter Model</a> •
  <a href="./docs/task-model.md">Task Model</a> •
  <a href="./commands/emb/help.md">Command Help</a>
</p>

emb-agent is a lightweight workflow layer for embedded development.

It is built for the kind of firmware work that normal AI coding loops handle badly: MCU datasheets, pin mux conflicts, timer formulas, board constraints, peripheral ownership, register-level debugging, and long-running sessions where important hardware facts are easy to lose.

Instead of treating firmware work like generic code generation, emb-agent keeps durable hardware truth in the project, gives the agent a small command flow, and makes it easy to move from "what chip is this?" to "which pin owns PWM output?" to "what should I do next?" without rebuilding context every session.

## One Embedded Product, Layered Internals

emb-agent is one product, and it is primarily in service of embedded work.

The repository looks broad because it contains several internal layers that all support that same goal:

- embedded runtime flow:
  project truth, task/session flow, document ingestion, and adapter-oriented routing
- runtime support:
  reusable skills, memory, and delegation surfaces that keep long sessions usable
- structural support:
  scaffolds, shell entries, hooks, and protocol blocks that keep agent behavior stable instead of drifting

These are not separate products. They are supporting layers around the same embedded workflow.

The intended posture is:

- The default user path stays centered on `init`, `declare hardware`, `next`, `scan`, `do`, `review`, and `verify`.
- Skills, scaffolds, hooks, and shell templates exist to make the embedded workflow more reliable, not to compete with it as a separate center of gravity.

See [docs/product-boundaries.md](./docs/product-boundaries.md) for the explicit layering.

## What's New

- Direct hardware declaration with `declare hardware`, so known MCU/package/pin facts can be written immediately.
- Install-time developer identity, reused automatically by `init`.
- Richer task manifests with schema-backed `task.json` metadata.
- Better document-to-truth flow and stronger embedded-first command posture around `declare hardware`, `ingest`, and `verify`.
- Default help now stays focused on the shortest onboarding path, with advanced commands behind `help advanced`.
- Runtime support improvements for longer sessions, including reusable skills, layered memory, and real delegation modes.

## Why emb-agent?

| Capability | What it changes |
| --- | --- |
| **Hardware truth in the repo** | Keep MCU model, package, signals, peripherals, constraints, and unknowns in `.emb-agent/hw.yaml` instead of repeating them in chat. |
| **Direct hardware declaration** | Use `declare hardware` to write MCU, package, pins, and peripherals directly, instead of re-explaining the project every time. |
| **Short default workflow** | Most users only need `init`, `declare hardware`, and `next` to start, then follow `scan/plan/do/debug/review/verify` as needed. |
| **Document-to-truth flow** | Import datasheets or manuals with `ingest doc`, then land useful facts back into truth files. |
| **Adapter-oriented execution** | Keep core workflow abstract while pushing chip-, family-, and vendor-specific formulas and routes into adapters. |
| **Verification-aware closure** | Close work with explicit review and verify loops instead of treating embedded changes like generic code generation. |
| **Runtime-aware setup** | Install into Codex, Claude Code, or Cursor runtimes without changing the project-side structure. |
| **Session continuity** | Keep handoffs, state, and visible project artifacts so the next session starts from reality, not from scratch. |
| **Long-session support** | Add reusable skills, layered memory, and delegation only when the embedded workflow becomes long-running or repetitive. |

## Quick Start

### 1. Install emb-agent into your runtime

For Codex:

```bash
npx emb-agent --codex --local --developer your-name
```

This installs:

- project-scoped runtime files under `./.codex/emb-agent/`
- project-scoped Codex agents under `./.codex/agents/`
- project-scoped Codex-discoverable public emb skills under `./.codex/skills/`

As of Codex CLI `v0.116.0` on `2026-03-24`, hooks are still experimental and must be enabled manually in `~/.codex/config.toml` unless your team config already enables them:

```toml
[features]
multi_agent = true
codex_hooks = true
```

emb-agent does not write these feature flags automatically. If Codex later enables hooks by default, this manual step may no longer be required.

For Claude Code:

```bash
npx emb-agent --claude --local --developer your-name
```

This installs Claude integration into the repository under `./.claude/`, including:

- project-scoped runtime files under `./.claude/emb-agent/`
- project-scoped agents under `./.claude/agents/`
- project-scoped command wrappers under `./.claude/commands/emb/`
- project-scoped hook configuration in `./.claude/settings.json`

For Cursor:

```bash
npx emb-agent --cursor --local --developer your-name
```

This installs Cursor integration into the repository under `./.cursor/`, including:

- project-scoped runtime files under `./.cursor/emb-agent/`
- project-scoped agents under `./.cursor/agents/`
- project-scoped command wrappers under `./.cursor/commands/`
- project-scoped hook configuration in `./.cursor/settings.json`

`--developer` is required during install. The value is stored in runtime config and reused by `init`, so you do not have to re-enter your developer identity in every project.

### 2. Use emb-agent inside the session

You do not need to run any internal CLI path yourself.

After install, open the project in Codex, Claude Code, or Cursor and use emb-agent directly in the session. The host integration handles runtime invocation for you.

If a workflow is product-specific instead of broadly reusable, keep it as a project-local extension under `.emb-agent/` and load it with `init --pack <project-local-pack>` rather than adding it to built-in runtime packs. See [docs/workflow-layering.md](./docs/workflow-layering.md) and the [smart pillbox example](./examples/project-extensions/smart-pillbox/README.md).

The shortest onboarding path and session command flow are documented in [docs/quick-start.md](./docs/quick-start.md) and [commands/emb/help.md](./commands/emb/help.md).

The public command surface is intentionally kept small. In Codex it is mirrored as skills such as `emb-init` and `emb-next`; in slash-command hosts the same surface can appear as `$emb-*` commands:

- Start: `init`, `ingest`, `next`, `task`
- Execute: `scan`, `plan`, `do`, `debug`
- Close: `review`, `verify`, `pause`, `resume`

Everything else is treated as advanced runtime surface rather than default user-facing slash commands.

If the MCU is already known, the shortest path is:

`init -> declare hardware -> next`

If the project is still at concept stage and the MCU is not chosen yet, the shortest path is:

`init -> record goals/constraints in req.yaml -> next`

You do not need to invent a placeholder MCU just to start using emb-agent.

## Product Model

The most important thing to understand about emb-agent is not the full command list. It is the object model.

### 1. Truth

Shared project truth lives in visible repo files:

```text
.emb-agent/
├── hw.yaml
├── req.yaml
└── project.json
```

- `hw.yaml`
  MCU, package, board signals, peripherals, constraints, and unknowns.
- `req.yaml`
  Goals, features, acceptance, and failure policy.
- `project.json`
  Project defaults, integrations, and workflow preferences.

### 2. Tasks

Longer work is captured under:

```text
.emb-agent/tasks/<task-name>/task.json
```

Tasks carry ownership, priority, branch context, related files, and lifecycle metadata. See [docs/task-model.md](./docs/task-model.md).

### 3. Runtime

Host-specific runtime state stays outside the repo:

- installed CLI
- session state
- handoff state
- runtime config
- runtime hooks

This means the repo keeps durable shared truth, while the runtime keeps personal continuity.

### 4. Skills and memory

emb-agent also ships reusable runtime-side guidance:

- `skills/`
  Reusable workflows that can be listed, inspected, and executed on demand.
- `memory/`
  Built-in instruction-memory layers that combine with user, project, and local memory.

These resources are runtime-facing. They support the session, but they do not replace visible project truth in `.emb-agent/`.

## Embedded Flow And Support Layers

The repository contains the embedded workflow itself plus the support layers around it.

Embedded flow includes:

- hardware truth files under `.emb-agent/`
- default session flow such as `init -> declare hardware -> next`
- task manifests and task-local execution state
- document ingestion and truth promotion
- adapter-aware routing and execution readiness

Support layers include:

- reusable runtime skills exposed through `skills list/show/run`
- scaffold trees for skills, shells, hooks, and protocol blocks
- harness-facing entry files such as `AGENTS.md`, `CODEX.md`, `CLAUDE.md`, and `GEMINI.md`
- workflow/spec template layers used to keep long-running agent setups consistent

These layers live together because they all serve the embedded workflow. If you are only trying to use emb-agent on a firmware project, stay on the embedded-flow path first.

## Shared Vs Personal Layers

This boundary is one of the biggest differences between emb-agent and generic prompt-driven workflows.

### Shared project layer

These should stay visible and reviewable in the repository:

- `.emb-agent/hw.yaml`
- `.emb-agent/req.yaml`
- `.emb-agent/project.json`
- `.emb-agent/tasks/`
- generated project docs and checklists

### Personal runtime layer

These belong to the installed runtime, not the project repository:

- session continuity
- pause/resume handoffs
- layered instruction memory
- durable auto-memory entries
- runtime install metadata
- host integration state
- developer identity defaults

This makes it easier to keep project truth collaborative without losing personal continuity between sessions.

## Scenarios

emb-agent works best when the user can quickly identify which real-world scenario they are in.

Examples:

- Existing MCU repository, but hardware identity is not fully locked yet
- Known pin map, no need for repeated questioning
- Datasheet still holds the truth, so PDF import comes before implementation
- Peripheral bring-up such as PWM / ADC / comparator / timer work
- Long-running debug session that needs pause/resume and task tracking

See [docs/scenarios.md](./docs/scenarios.md) for concrete flows.

## Starters

emb-agent already includes reusable starters for embedded work:

- starter hardware truth for chips such as `SC8F072`, `PMS150G`, and `PMB180B`
- requirement starters for those same chips
- project-local chip/tool extension scaffolds
- task manifest scaffold

These live under the runtime scaffolding layer and are intended to make repeated embedded setup less manual over time.

## Platforms

emb-agent currently supports the same workflow model across multiple AI runtimes:

- Codex
- Claude Code

Platform-specific install and runtime-path details are documented in [docs/platforms.md](./docs/platforms.md).

## Adapter Model

emb-agent core stays abstract on purpose.

The core owns:

- command flow
- truth layers
- session continuity
- task structures
- tool and chip contracts

Vendor-, family-, and chip-specific formulas and routes belong in adapters.

Workflow guidance follows a similar layering rule:

- keep core rules abstract
- keep built-in packs at the engineering-domain level
- keep product-specific packs and specs in project-local workflow extensions under `.emb-agent/`

See [docs/adapter-model.md](./docs/adapter-model.md) for the intended separation between core and adapter responsibilities.
See [docs/workflow-layering.md](./docs/workflow-layering.md) for the pack/spec layering rule.

## Command Reference

README stays human-facing. Command behavior and agent-oriented execution guidance live in [commands/emb/help.md](./commands/emb/help.md), [commands/emb/skills.md](./commands/emb/skills.md), [commands/emb/memory.md](./commands/emb/memory.md), and runtime help output (`help`, `help advanced`).

## FAQ

### Is this a build / flash / debug orchestrator?

Not yet.

emb-agent is currently strongest at hardware truth management, session flow, command guidance, doc ingestion, and adapter-oriented tool routing. It does not try to pretend all vendor build, flash, and debug chains are the same.

### Why not keep everything in one giant instruction file?

Because embedded projects usually need different kinds of truth:

- durable hardware facts
- evolving requirements
- current session state
- runtime-specific integration

emb-agent separates those layers so the agent does not have to rediscover them every time.

### Do I have to answer "what project is this?" over and over?

No.

That is exactly what `init`, `declare hardware`, `hw.yaml`, `req.yaml`, and runtime developer identity are meant to avoid.

### What if I already know the pin map?

Then skip the conversational loop and write it directly with `declare hardware`.

That is the intended path for experienced embedded engineers.

### When should I use `declare hardware` vs `ingest doc`?

Use `declare hardware` when:

- you already know the MCU or package
- you already know which pin owns which signal
- you already know which peripheral block is being used

Use `ingest doc` when:

- the truth still lives in a datasheet or manual
- the pin mux or timing limits are still uncertain
- you need evidence-backed extraction before implementation

## Release Notes

See [RELEASE.md](./RELEASE.md).
