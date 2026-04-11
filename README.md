<p align="center">
  <strong>A hardware-first AI workflow for embedded firmware projects</strong><br/>
  <sub>Keep MCU truth, pin usage, peripherals, constraints, and verification visible in the repo.</sub>
</p>

<p align="center">
  Codex • Claude Code • Brownfield MCU repos • Register-heavy debugging • Datasheet-grounded work
</p>

<p align="center">
  <a href="./docs/README.md">Docs</a> •
  <a href="./docs/quick-start.md">Quick Start</a> •
  <a href="./docs/platforms.md">Platforms</a> •
  <a href="./docs/scenarios.md">Scenarios</a> •
  <a href="./docs/adapter-model.md">Adapter Model</a> •
  <a href="./docs/task-model.md">Task Model</a> •
  <a href="./commands/emb/help.md">Command Help</a>
</p>

emb-agent is a lightweight workflow layer for embedded development.

It is built for the kind of firmware work that normal AI coding loops handle badly: MCU datasheets, pin mux conflicts, timer formulas, board constraints, peripheral ownership, register-level debugging, and long-running sessions where important hardware facts are easy to lose.

Instead of treating firmware work like generic code generation, emb-agent keeps durable hardware truth in the project, gives the agent a small command flow, and makes it easy to move from "what chip is this?" to "which pin owns PWM output?" to "what should I do next?" without rebuilding context every session.

## What's New

- Direct hardware declaration with `declare hardware`, so known MCU/package/pin facts can be written immediately.
- Install-time developer identity, reused automatically by `init`.
- Richer task manifests with schema-backed `task.json` metadata.
- Default help now stays focused on the shortest onboarding path, with advanced commands behind `help advanced`.
- Built-in skill discovery with lazy loading, so reusable workflow skills stay cataloged without loading every body into every session.
- Layered instruction memory plus durable auto-memory extraction, so cross-session conclusions can be reviewed and promoted instead of getting trapped in chat history.
- Real multi-agent delegation patterns through the host bridge, with `coordinator`, `fork`, and `swarm` execution shapes instead of a single placeholder contract.

## Why emb-agent?

| Capability | What it changes |
| --- | --- |
| **Hardware truth in the repo** | Keep MCU model, package, signals, peripherals, constraints, and unknowns in `.emb-agent/hw.yaml` instead of repeating them in chat. |
| **Direct hardware declaration** | Use `declare hardware` to write MCU, package, pins, and peripherals directly, instead of re-explaining the project every time. |
| **Short default workflow** | Most users only need `init`, `declare hardware`, and `next` to start, then follow `scan/plan/do/debug/review/verify` as needed. |
| **Document-to-truth flow** | Import datasheets or manuals with `ingest doc`, then land useful facts back into truth files. |
| **Runtime-aware setup** | Install into Codex or Claude Code runtimes without changing the project-side structure. |
| **Session continuity** | Keep handoffs, state, and visible project artifacts so the next session starts from reality, not from scratch. |
| **Lazy skill catalog** | Discover reusable skills with `skills list/show/run` without paying to load every skill body up front. |
| **Layered memory** | Stack organization, user, project, and local memory, then promote durable findings intentionally instead of burying them in prompts. |
| **Real delegation modes** | Use `dispatch run` / `orchestrate run` with host bridge support and steer the execution shape with `orchestration_mode=coordinator|fork|swarm`. |

## Quick Start

### 1. Install emb-agent into your runtime

For Codex:

```bash
npx emb-agent --codex --global --developer your-name
```

As of Codex CLI `v0.116.0` on `2026-03-24`, hooks are still experimental and must be enabled manually in `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
codex_hooks = true
```

emb-agent does not write these feature flags automatically. If Codex later enables hooks by default, this manual step may no longer be required.

For Claude Code:

```bash
npx emb-agent --claude --global --developer your-name
```

`--developer` is required during install. The value is stored in runtime config and reused by `init`, so you do not have to re-enter your developer identity in every project.

### 2. Use emb-agent inside the session

You do not need to run any internal CLI path yourself.

After install, open the project in Codex or Claude Code and use emb-agent directly in the session. The host integration handles runtime invocation for you.

If a workflow is product-specific instead of broadly reusable, keep it as a project-local extension under `.emb-agent/` and load it with `init --pack <project-local-pack>` rather than adding it to built-in runtime packs. See [docs/workflow-layering.md](./docs/workflow-layering.md) and the [smart pillbox example](./examples/project-extensions/smart-pillbox/README.md).

The shortest onboarding path and session command flow are documented in [docs/quick-start.md](./docs/quick-start.md) and [commands/emb/help.md](./commands/emb/help.md).

The public command surface is intentionally kept small:

- Start: `init`, `ingest`, `next`, `task`
- Execute: `scan`, `plan`, `do`, `debug`
- Close: `review`, `verify`, `pause`, `resume`

Everything else is treated as advanced runtime surface rather than default user-facing slash commands.

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
