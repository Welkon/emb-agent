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

## Architecture

emb-agent sits between the AI assistant and your repository. It does not replace the assistant; it gives the assistant reliable embedded project memory.

| Layer | What it does | Examples |
|---|---|---|
| **User** | Describes product-level intent | “Bring up PWM dimming”, “Check the schematic”, “Continue the active task” |
| **AI assistant** | Converses, writes code, asks for clarification | Codex, Claude Code, Cursor |
| **Host integration** | Starts emb-agent automatically and exposes project-aware actions | Codex hooks, Claude/Cursor command docs |
| **Rust runtime** | Reads project state, routes workflow, analyzes hardware artifacts | session, task, schematic, knowledge, diagnostics |
| **Project memory** | Stores the facts that should survive across sessions | `.emb-agent/hw.yaml`, `req.yaml`, `tasks/`, `graph/`, `wiki/`, `cache/` |

### Runtime modules

| Module | Purpose |
|---|---|
| **Session** | Detect project state and recommend the next step |
| **Task** | Track active work, decisions, reviews, and closure |
| **Schematic** | Parse and summarize schematic / board artifacts |
| **Hardware** | Keep chip, board, pin, and peripheral context aligned |
| **Knowledge** | Build project memory through graph and wiki records |
| **Workflow** | Guide work through scan, plan, implement, review, and verify |
| **Diagnostics** | Report hook, project, and state-path health |

### Specialized agents

emb-agent ships a set of workflow-specific sub-agents that the AI assistant can delegate to. Each agent has a narrow scope and clear acceptance criteria.

| Agent | Role |
|---|---|
| **onboard** | Project initialization and migration — scaffolds `.emb-agent/` for empty repos, or audits and maps existing hardware docs |
| **hw-scout** | Hardware truth investigation — locates datasheets, schematics, pin maps, and register-level facts |
| **fw-doer** | Minimal code and documentation changes with structure health pre-checks |
| **arch-reviewer** | Architecture review against embedded constraints (ROM/RAM budgets, ISR latency, power domains) |
| **bug-hunter** | Root-cause analysis of hardware-software bugs with register-level tracing |
| **sys-reviewer** | System-level review across firmware, schematic, and requirements |
| **release-checker** | Pre-release validation of build, tests, and release artifacts |

---

## User flow

### 1. Open an AI session

Start Codex, Claude Code, or Cursor inside your firmware repository.

If the project has not been initialized yet, or if existing hardware truth is scattered across datasheets, schematics, pin maps, build files, and notes, emb-agent routes the assistant through **onboard** first. Onboard chooses the lightest safe path:

1. empty repo scaffold
2. partial `.emb-agent/` repair
3. migration audit for existing firmware repos

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

> “Bring up the LED driver.”
>
> “Check whether the schematic has obvious risks.”
>
> “Continue the active task.”
>
> “What should we do next?”

emb-agent supplies the context and routing information the AI needs behind the scenes.

### 4. Work through a controlled loop

Typical embedded work follows the same shape:

1. understand the current state
2. plan the change
3. implement the work
4. review the result
5. verify against hardware and requirements
6. record what was learned

The user sees a normal AI conversation. emb-agent keeps the task state, evidence, and review trail organized in the project.

### 5. Let the project learn

Schematic findings, datasheet facts, debugging notes, task decisions, and verification outcomes accumulate into the knowledge graph and wiki.

The longer the project runs with emb-agent, the less context you need to repeat.

---

## What users usually need to remember

Almost nothing.

Open the AI assistant in the project and ask for work. If you ever need a manual nudge, ask:

> “What should we do next?”

The assistant will route that through emb-agent and continue from the current project state.

---

## Install

Recommended interactive install:

```bash
npx emb-agent
```

Direct install examples:

```bash
npx emb-agent --target codex --local --lang zh
npx emb-agent --target all --local --lang zh
npx emb-agent --target all --local --dry-run
```
Where `<host>` is one of the enabled targets: `codex`, `claude`, `cursor`, or `all`.

Interactive install scans for `emb-support` (via `EMB_SUPPORT_DIR`, project ancestors, the installer checkout, or the home directory) and prompts for external support specs and skills. Direct installs can select the same support entries with repeatable `--spec <name>` and `--skill <name>` flags.

> **Note:** `pi`, `omp`, and `windsurf` are disabled by default in development builds. OMP support is currently off; do not remove it from `shells.json.disabled` unless you are reviving that integration.
### Local vs global

- `--local` writes host integration into this project. Use it for project-specific setup and team-visible behavior.
- `--global` writes into the host's user config directory. Use it for personal defaults across projects.
- `--dry-run` prints the install plan without writing files.
- `repair --target <host|all>` rebuilds managed host integrations without resetting project truth.
- `uninstall --target <host|all>` removes managed host integrations and preserves `.emb-agent` project truth.

### Host command surface

Every enabled host exposes the same two emb-agent entrypoints through its native mechanism:

| Host | Surface | Entries |
|---|---|---|
| Claude Code | `.claude/commands/*.md` | `/emb-next`, `/emb-onboard` |
| Cursor | command files | `/emb-next`, `/emb-onboard` |
| Codex | `.agents/skills/<name>/SKILL.md` | `$emb-next`, `$emb-onboard` |

After install, emb-agent writes `.emb-agent/.install/INSTALL_RESULT.md`, runs an install check, and prints host-specific reload instructions. To diagnose later:

```bash
node .codex/emb-agent/bin/emb-agent.cjs doctor --host codex --brief
node .codex/emb-agent/bin/emb-agent.cjs diagnostics hooks --host codex --runtime-dir .codex/emb-agent
```

Recommended first-use flow:

1. Restart or reload the target host after install or repair.
2. Codex only: run `/hooks` and trust pending project hooks.
3. New project: run `/emb onboard`.
4. Existing emb-agent project: run `/emb start`.
5. Continue work from runtime guidance: run `/emb next`.

If startup context is missing, run the hook diagnostics command above before changing project files.

Or build from source:

```bash
git clone <repo>
cd emb-agent
cargo build --release
```

---

## Documentation

| Document | Purpose |
|---|---|
| [Product Boundaries](docs/product-boundaries.md) | What emb-agent is and is not — product scope and layer boundaries |
| [Command Docs](command-docs/emb/) | Human-readable command reference (chip, etc.) |
| [Scenarios](docs/scenarios.md) | How emb-agent fits common project situations |
| [Task Model](docs/task-model.md) | How work is tracked and closed |
| [Chip Support Model](docs/chip-support-model.md) | How reusable chip knowledge is structured |
| [AI Host Contract](docs/ai-host-contract.md) | Integration rules for AI runtimes |
| [Automation Contract](docs/automation-contract.md) | Stable machine-readable outputs |
| [Workflow Layering](docs/workflow-layering.md) | Core vs project-specific workflow boundaries |
| [Command Reference](commands/emb/help.md) | Default command flow plus full installed command docs; host slash surfaces still expose `/emb-next` and `/emb-onboard` |

---

<p align="center">
  <sub>MIT</sub>
</p>
