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

Installable skill bundles can add executable capabilities such as scope control, build, flash, or debug flows without expanding the default core workflow.
When a project wants those executable skills to participate in closure, declare them in `quality_gates.required_skills` so `verify` and `next` can drive `skills run` before manual signoff.

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

### 2. Open a session

emb-agent injects the startup context automatically when the session opens. On the first run it initializes the repo automatically, then tells you the shortest next step.

Use `start` only when you want to re-render that entry context manually.

### 3. Continue with the shortest hardware path

If the MCU is already known:

`declare hardware -> bootstrap run --confirm -> next run`

If the MCU is still unknown:

`record goals and constraints in .emb-agent/req.yaml -> next`

If the truth still lives in a datasheet or schematic:

`ingest doc` or `ingest schematic` -> review/apply -> `next`

The full onboarding path is in [docs/quick-start.md](./docs/quick-start.md). Platform-specific setup differences are in [docs/platforms.md](./docs/platforms.md).

## Automation Surfaces

Use the smallest surface that matches the caller:

- `next --brief`
  Compact JSON for local automation or lightweight wrappers. It keeps the recommended command, action card, next actions, and summarized `runtime_events` without the full session payload.
- `external <start|status|next|health|dispatch-next>`
  Stable external-driver envelope for host skills, MCP-style bridges, or wrappers that only need `status`, `summary`, `next.cli`, and summarized `runtime_events`.
- `task worktree status|show <name>`
  Inspect isolated task workspaces before `create` or `cleanup`. These commands surface `workspace_state`, `attention`, and a plain-language `summary` so the operator can see whether the workspace is detached, dirty, missing, or ready.

`runtime_events` are the shortest structured explanation of why the runtime is nudging the user. In practice:

- `clear`: no notable runtime signal is active
- `ok`: the runtime observed something useful but non-blocking
- `pending`: there is still a recommended follow-up or operator attention point
- `blocked` or `failed`: the flow should not continue blindly

## How It Works

emb-agent keeps shared project truth in visible repo files:

```text
.emb-agent/
├── hw.yaml
├── plugins/
├── req.yaml
├── project.json
└── tasks/
```

- `hw.yaml`: MCU, package, signals, peripherals, constraints, and unknowns.
- `plugins/`: optional project-scoped skill bundles installed through `skills install`.
- `req.yaml`: goals, interfaces, acceptance, and failure policy.
- `project.json`: project defaults and workflow preferences.
- `tasks/`: task-local PRD, context, and lifecycle state.

Host-specific runtime state stays outside the repo. That keeps project truth collaborative while leaving session continuity, hooks, and runtime metadata in the selected host runtime.

## Positioning

emb-agent has three layers:

- **Embedded workflow**: the default project path built around startup context, `declare hardware`, `next`, task flow, repo truth, and manual `start` re-entry when needed.
- **Chip-support runtime**: family-, device-, and chip-specific formulas, bindings, routes, and executable tool logic.
- **Host integration surface**: skills, installable skill bundles, commands, hooks, and shell entry files that adapt emb-agent to different AI coding hosts.

That means emb-agent should be understood as embedded project infrastructure, not as a standalone skill library.

## Why emb-agent

| Capability | What it changes |
| --- | --- |
| **Hardware truth in the repo** | Keep MCU model, package, signals, peripherals, constraints, and unknowns in `.emb-agent/hw.yaml` instead of repeating them in chat. |
| **Short default workflow** | Most projects only need session startup context, `declare hardware`, `next`, and the execution loop behind them. |
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
- [Automation Output Contract](./docs/automation-contract.md)
- [Workflow Layering](./docs/workflow-layering.md)
- [Command Help](./commands/emb/help.md)
- [Release Notes](./RELEASE.md)
