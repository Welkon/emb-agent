# emb-agent

<p align="center">
  <strong>Embedded firmware workflow memory for AI coding assistants</strong><br>
  <sub>Describe your hardware once. Every future AI session starts with the right board context.</sub>
</p>

<p align="center">
  <a href="./README.zh.md">中文</a>
  ·
  <a href="docs/scenarios.md">Scenarios</a>
  ·
  <a href="docs/task-model.md">Task Model</a>
  ·
  <a href="docs/chip-support-model.md">Chip Support</a>
</p>

---

## Why it exists

Embedded firmware work has a problem: the AI forgets the board.

You keep repeating the same facts:

- which MCU and package the product uses
- which signal is connected to which pin
- which peripherals are already reserved
- what the schematic says
- what the current task is supposed to achieve

**emb-agent turns those facts into project memory.**

The AI assistant reads that memory at the start of each session, so you can talk in product terms instead of restating hardware context.

---

## System architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                              User                                    │
│                                                                      │
│  "Bring up PWM dimming"                                              │
│  "Check the schematic"                                               │
│  "What should we do next?"                                           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         AI Coding Assistant                          │
│                                                                      │
│  Pi · Codex · Claude Code · Cursor                                   │
│                                                                      │
│  The assistant receives project context automatically:                │
│  • hardware truth                                                     │
│  • active tasks                                                       │
│  • schematic summary                                                  │
│  • knowledge graph hints                                              │
│  • recommended next step                                              │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                │  host integration
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         emb-agent runtime                            │
│                                                                      │
│  Pi extension        Codex hooks        Claude/Cursor commands        │
│       │                  │                       │                    │
│       └──────────────────┴───────────────────────┘                    │
│                                │                                     │
│                        thin wrapper                                  │
│                                │                                     │
│                                ▼                                     │
│                         emb-agent-rs                                 │
│                           Pure Rust                                  │
│                                                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐    │
│  │  Session   │ │    Task    │ │ Schematic  │ │   Knowledge    │    │
│  │  startup   │ │ lifecycle  │ │  analysis  │ │ graph / memory │    │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘    │
│                                                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐    │
│  │ Hardware   │ │  Lookup    │ │ Workflow   │ │ Diagnostics    │    │
│  │ chip/board │ │ docs/parts │ │ route/next │ │ hooks/status   │    │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                            .emb-agent/                               │
│                                                                      │
│  hw.yaml        hardware truth: MCU, pins, signals, peripherals      │
│  req.yaml       product goals, constraints, acceptance rules          │
│  tasks/         active work, decisions, After Action Reviews          │
│  graph/         project knowledge graph                              │
│  wiki/          long-term project notes                              │
│  cache/         parsed schematics, board files, document facts        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## User flow

### 1. Open an AI session

Start Pi, Codex, Claude Code, or Cursor inside your firmware repository.

If the project has not been initialized yet, emb-agent detects that and guides the assistant to initialize the `.emb-agent/` workspace automatically.

### 2. Confirm the hardware truth

The assistant helps collect the facts that should not be guessed:

- MCU / package
- pin assignments
- power and clock assumptions
- peripheral ownership
- schematic-derived constraints
- product requirements

Once confirmed, those facts become project memory.

### 3. Ask for product-level work

You do not need to think in tool commands.

Say things like:

> "Bring up the LED driver."
>
> "Check whether the schematic has obvious risks."
>
> "Continue the active task."
>
> "What should we do next?"

emb-agent supplies the context and routing information the AI needs behind the scenes.

### 4. Work through a controlled loop

Typical embedded work follows the same shape:

```text
scan → plan → implement → review → verify → record lessons
```

The user sees a normal AI conversation. emb-agent keeps the task state, evidence, and review trail organized in the project.

### 5. Let the project learn

Schematic findings, datasheet facts, debugging notes, task decisions, and verification outcomes accumulate into the knowledge graph and wiki.

The longer the project runs with emb-agent, the less context you need to repeat.

---

## What users usually need to remember

Almost nothing.

Open the AI assistant in the project and ask for work. If you ever need a manual nudge, ask:

> "What should we do next?"

The assistant will route that through emb-agent and continue from the current project state.

---

## Install

From npm:

```bash
npx emb-agent --target pi
```

Or build from source:

```bash
git clone <repo>
cd emb-agent
cargo build --release
```

Supported hosts: **Pi**, **Codex**, **Claude Code**, **Cursor**.

---

## Documentation

| Document | Purpose |
|---|---|
| [Scenarios](docs/scenarios.md) | How emb-agent fits common project situations |
| [Task Model](docs/task-model.md) | How work is tracked and closed |
| [Chip Support Model](docs/chip-support-model.md) | How reusable chip knowledge is structured |
| [AI Host Contract](docs/ai-host-contract.md) | Integration rules for AI runtimes |
| [Automation Contract](docs/automation-contract.md) | Stable machine-readable outputs |
| [Workflow Layering](docs/workflow-layering.md) | Core vs project-specific workflow boundaries |
| [Command Reference](commands/emb/help.md) | Full command surface for AI/automation authors |

---

<p align="center">
  <sub>MIT</sub>
</p>
