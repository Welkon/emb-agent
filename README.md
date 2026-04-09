<p align="center">
  <strong>A hardware-first AI workflow for embedded firmware projects</strong><br/>
  <sub>Keep MCU truth, pin usage, peripherals, constraints, and verification visible in the repo.</sub>
</p>

<p align="center">
  Codex • Claude Code • Brownfield MCU repos • Register-heavy debugging • Datasheet-grounded work
</p>

<p align="center">
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

## Why emb-agent?

| Capability | What it changes |
| --- | --- |
| **Hardware truth in the repo** | Keep MCU model, package, signals, peripherals, constraints, and unknowns in `.emb-agent/hw.yaml` instead of repeating them in chat. |
| **Direct hardware declaration** | Use `declare hardware` to write MCU, package, pins, and peripherals directly, instead of re-explaining the project every time. |
| **Short default workflow** | Most users only need `init`, `declare hardware`, and `next` to start. |
| **Document-to-truth flow** | Import datasheets or manuals with `ingest doc`, then land useful facts back into truth files. |
| **Runtime-aware setup** | Install into Codex or Claude Code runtimes without changing the project-side structure. |
| **Session continuity** | Keep handoffs, state, and visible project artifacts so the next session starts from reality, not from scratch. |

## Quick Start

### 1. Install emb-agent into your runtime

For Codex:

```bash
npx emb-agent --codex --global --developer your-name
```

For Claude Code:

```bash
npx emb-agent --claude --global --developer your-name
```

`--developer` is required during install. The value is stored in runtime config and reused by `init`, so you do not have to re-enter your developer identity in every project.

### 2. Use the installed runtime CLI inside a repo

emb-agent installs a runtime CLI under your host runtime directory.

- Codex default path: `node ~/.codex/emb-agent/bin/emb-agent.cjs`
- Claude Code default path: `node ~/.claude/emb-agent/bin/emb-agent.cjs`

Examples below use:

```bash
<runtime-cli>
```

### 3. Follow the default path

```bash
<runtime-cli> init
<runtime-cli> declare hardware --mcu SC8F072 --package SOP8
<runtime-cli> next
```

This is the shortest useful path for most projects.

If the engineer already knows board signals and peripheral ownership:

```bash
<runtime-cli> declare hardware \
  --signal PWM_OUT --pin PA3 --dir output \
  --peripheral PWM --usage "warm dimming"
```

If the truth still lives in a PDF:

```bash
<runtime-cli> ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware
```

More detailed setup instructions are in [docs/quick-start.md](./docs/quick-start.md).

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

### 3. Workspace

emb-agent also supports longer-lived work surfaces such as workspaces, specs, and threads for larger projects or multi-step investigations. These are advanced layers, not required for onboarding.

### 4. Runtime

Host-specific runtime state stays outside the repo:

- installed CLI
- session state
- handoff state
- runtime config
- runtime hooks

This means the repo keeps durable shared truth, while the runtime keeps personal continuity.

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
- runtime install metadata
- host integration state
- developer identity defaults

This makes it easier to keep project truth collaborative without losing personal continuity between sessions.

## Typical Flow

For most projects, the shortest useful path is:

```text
install -> init -> declare hardware -> next
```

After that:

- Use `scan` when you need code entry points or hardware-related files.
- Use `plan` when the task needs a small execution plan.
- Use `do` when you already know the exact change to apply.
- Use `debug` when the symptom is clear but the root cause is not.
- Use `verify` when implementation is done and you want explicit closure.
- Use `pause` and `resume` when the session is getting noisy.

## Scenarios

emb-agent works best when the user can quickly identify which real-world scenario they are in.

Examples:

- Existing MCU repository, but hardware identity is not fully locked yet
- Known pin map, no need for repeated questioning
- Datasheet still holds the truth, so PDF import comes before implementation
- Peripheral bring-up such as PWM / ADC / comparator / timer work
- Long-running debug session that needs pause/resume and task tracking

See [docs/scenarios.md](./docs/scenarios.md) for concrete flows.

## Starters And Templates

emb-agent already includes reusable starters and templates for embedded work:

- starter hardware truth for chips such as `SC8F072`, `PMS150G`, and `PMB180B`
- requirement starters for those same chips
- project-local chip/tool extension templates
- task manifest template

These live under the runtime template system and are intended to make repeated embedded setup less manual over time.

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
- task/workspace structures
- tool and chip contracts

Vendor-, family-, and chip-specific formulas and routes belong in adapters.

See [docs/adapter-model.md](./docs/adapter-model.md) for the intended separation between core and adapter responsibilities.

## Command Guide

### Core commands

- `init`
  Initialize the current project and generate the truth-layer scaffold.
- `declare hardware`
  Write MCU, package, pin usage, and peripheral usage into hardware truth directly.
- `next`
  Ask emb-agent for the default next step.
- `ingest doc`
  Pull hardware facts out of a PDF or manual when the answer is not known yet.
- `task`
  Track implementation work when the task is no longer one-shot.

These are the only commands a new user usually needs at the start.

### Workflow commands

- `scan`
  Locate entry points, hardware truth, docs, and relevant files.
- `plan`
  Build a short task plan.
- `do`
  Apply a focused implementation or doc change.
- `debug`
  Narrow down root causes.
- `verify`
  Close work with checks and evidence.
- `pause` / `resume`
  Preserve context across long or interrupted sessions.

### Advanced commands

Commands such as `adapter`, `dispatch`, `orchestrate`, `workspace`, `thread`, `spec`, `manager`, `settings`, and `executor` exist for advanced flows, but they are not part of the default onboarding path.

See [commands/emb/help.md](./commands/emb/help.md) for the full public command set.

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
