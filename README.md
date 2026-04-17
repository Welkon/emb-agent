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
  <a href="./commands/emb/help.md">Command Help</a>
</p>

emb-agent is a hardware-first AI workflow layer for embedded firmware repositories.

It keeps hardware truth in the repo, keeps the default command flow small, and gives the agent one consistent path from "what chip is this?" to "what should I do next?".

emb-agent is not just a skill pack or prompt wrapper. Skills, commands, hooks, and `AGENTS.md` files are host integration surfaces for Codex, Claude Code, Cursor, and similar runtimes. The product itself is the embedded workflow plus the chip-support runtime behind it.

When chip support appears in `health`, `next`, `support status`, or reports, read it in this order:

- `reusable`: already suitable for reuse across projects
- `reusable-candidate`: looks shareable after review
- `project-only`: keep it local until evidence and bindings improve

## Quick Start

### 1. Install into the repo

```bash
npx emb-agent
```

The installer will guide you through runtime selection and local setup. It creates `AGENTS.md` and bootstraps `.emb-agent/` in the current repository.

Use `--profile workflow` only when you are authoring scaffolds instead of using emb-agent day to day.

### 2. Open a session and run `start`

Start with `start`. On the first run it initializes the repo automatically, then tells you the shortest next step.

### 3. Continue with the shortest hardware path

If the MCU is already known:

`declare hardware -> bootstrap run --confirm -> next run`

If the MCU is still unknown:

`record goals and constraints in .emb-agent/req.yaml -> next`

If the truth still lives in a datasheet or schematic:

`ingest doc` or `ingest schematic` -> review/apply -> `next`

The full onboarding path is in [docs/quick-start.md](./docs/quick-start.md). Platform-specific setup differences are in [docs/platforms.md](./docs/platforms.md).

## How It Works

emb-agent keeps shared project truth in visible repo files:

```text
.emb-agent/
├── hw.yaml
├── req.yaml
├── project.json
└── tasks/
```

- `hw.yaml`: MCU, package, signals, peripherals, constraints, and unknowns.
- `req.yaml`: goals, interfaces, acceptance, and failure policy.
- `project.json`: project defaults and workflow preferences.
- `tasks/`: task-local PRD, context, and lifecycle state.

Host-specific runtime state stays outside the repo. That keeps project truth collaborative while leaving session continuity, hooks, and runtime metadata in the selected host runtime.

## Positioning

emb-agent has three layers:

- **Embedded workflow**: the default project path built around `start`, `declare hardware`, `next`, task flow, and repo truth.
- **Chip-support runtime**: family-, device-, and chip-specific formulas, bindings, routes, and executable tool logic.
- **Host integration surface**: skills, commands, hooks, and shell entry files that adapt emb-agent to different AI coding hosts.

That means emb-agent should be understood as embedded project infrastructure, not as a standalone skill library.

## Why emb-agent

| Capability | What it changes |
| --- | --- |
| **Hardware truth in the repo** | Keep MCU model, package, signals, peripherals, constraints, and unknowns in `.emb-agent/hw.yaml` instead of repeating them in chat. |
| **Short default workflow** | Most projects only need `start`, `declare hardware`, `next`, and the execution loop behind them. |
| **Document-to-truth flow** | Pull facts out of datasheets or schematics when the answer is not already known. |
| **Chip-support execution** | Keep chip-, family-, and vendor-specific logic in chip support packs instead of bloating the core workflow. |
| **Verification-aware closure** | Close work with explicit review and verify loops instead of generic code-only completion. |

## More Docs

- [Quick Start](./docs/quick-start.md)
- [Platforms](./docs/platforms.md)
- [Scenarios](./docs/scenarios.md)
- [Product Boundaries](./docs/product-boundaries.md)
- [Chip Support Model](./docs/chip-support-model.md)
- [Task Model](./docs/task-model.md)
- [Workflow Layering](./docs/workflow-layering.md)
- [Command Help](./commands/emb/help.md)
- [Release Notes](./RELEASE.md)
