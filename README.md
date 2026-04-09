# emb-agent

<p align="center">
  <strong>A hardware-first AI workflow for embedded firmware projects</strong><br/>
  <sub>Keep MCU truth, pin usage, peripherals, constraints, and verification visible in the repo.</sub>
</p>

<p align="center">
  Codex • Claude Code • Brownfield MCU repos • Register-heavy debugging • Datasheet-grounded work
</p>

emb-agent is a lightweight workflow layer for embedded development.

It is built for the kind of firmware work that normal AI coding loops handle badly: MCU datasheets, pin mux conflicts, timer formulas, board constraints, peripheral ownership, register-level debugging, and long-running sessions where important hardware facts are easy to lose.

Instead of treating firmware work like generic code generation, emb-agent keeps durable hardware truth in the project, gives the agent a small command flow, and makes it easy to move from "what chip is this?" to "which pin owns PWM output?" to "what should I do next?" without rebuilding context every session.

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

### 3. Initialize the project once

```bash
<runtime-cli> init
```

This prepares the project with visible truth layers and starter docs:

```text
.emb-agent/
├── project.json
├── hw.yaml
├── req.yaml
├── cache/
└── adapters/

docs/
├── MCU-FOUNDATION-CHECKLIST.md
└── ...
```

### 4. Declare hardware truth directly

If you already know the chip and package, lock them in immediately:

```bash
<runtime-cli> declare hardware --mcu SC8F072 --package SOP8
```

If you already know board signals and peripheral ownership:

```bash
<runtime-cli> declare hardware \
  --signal PWM_OUT --pin PA3 --dir output \
  --peripheral PWM --usage "warm dimming"
```

This is the preferred path for professional embedded users who already know the target MCU, pin map, or intended peripheral allocation.

### 5. Continue from the default command

```bash
<runtime-cli> next
```

When the task becomes timer-, PWM-, ADC-, comparator-, register-, or manual-heavy, move from `next` to `dispatch next` or `orchestrate`.

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

## Use Cases

### Lock chip and package identity before coding

If the repo already exists but hardware truth is incomplete:

```bash
<runtime-cli> init
<runtime-cli> declare hardware --mcu PMS150G --package SOP8
<runtime-cli> next
```

### Declare pin usage without waiting for repeated questions

If the engineer already knows the mapping:

```bash
<runtime-cli> declare hardware \
  --signal KEY_IN --pin PA4 --dir input \
  --signal PWM_OUT --pin PA3 --dir output \
  --peripheral PWM --usage "LED dimming"
```

### Import a datasheet and turn it into project truth

```bash
<runtime-cli> ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware
```

If the response includes an apply-ready diff, apply it first and then return to `next`.

### Continue a long-running debug session

```bash
<runtime-cli> pause "bench shows PWM glitch during wakeup"
# clear context / switch session
<runtime-cli> resume
```

## How It Works

emb-agent keeps the core project memory in visible project files and keeps runtime-specific state in the installed host runtime.

Project-side assets:

```text
.emb-agent/
├── hw.yaml          # MCU, package, board signals, peripherals, constraints, unknowns
├── req.yaml         # goals, features, acceptance, failure policy
├── project.json     # project defaults and preferences
├── adapters/        # project-local adapter assets
└── cache/           # doc and adapter-source cache

docs/
├── MCU-FOUNDATION-CHECKLIST.md
├── DEBUG-NOTES.md
└── ...
```

Host runtime assets:

- installed CLI
- session state
- handoff state
- runtime config
- runtime hooks

This split is deliberate:

- project truth stays reviewable and visible in the repo
- runtime state stays outside the repo
- the workflow remains consistent across Codex and Claude Code

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

Use `ingest doc` when truth is still hidden in a PDF, manual, or external document:

```bash
<runtime-cli> ingest doc --file <path> --provider mineru --kind datasheet --to hardware
```

Use `declare hardware` first when the engineer already knows the answer and just needs to write it down.

Commands such as `adapter`, `dispatch`, `orchestrate`, `workspace`, `thread`, `spec`, `manager`, `settings`, and `executor` exist for advanced flows, but they are not part of the default onboarding path.

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

## Public Command Reference

See [commands/emb/help.md](./commands/emb/help.md) for the full public command set.

## Release Notes

See [RELEASE.md](./RELEASE.md).
