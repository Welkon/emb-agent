<p align="center">
  <strong>AI-powered embedded firmware development workflow</strong><br/>
  <sub>Put your chip specs, pin assignments, and hardware constraints into the repo — let AI work with them directly.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/emb-agent"><img alt="npm" src="https://img.shields.io/npm/v/emb-agent?color=00d4ff"></a>
  <a href="https://github.com"><img alt="license" src="https://img.shields.io/badge/license-MIT-00d4ff"></a>
  <a href="./docs/README.md"><img alt="docs" src="https://img.shields.io/badge/docs-emb--agent-00d4ff"></a>
</p>

<p align="center">
  <a href="./README.zh.md">中文文档</a> ·
  <a href="./docs/quick-start.md">Quick Start</a> ·
  <a href="./docs/platforms.md">Platforms</a> ·
  <a href="./commands/emb/help.md">Commands</a>
</p>

---

## What is emb-agent?

When you work on embedded firmware with an AI assistant, you spend a lot of time repeating the same information: which MCU you're using, what pins are connected, what peripherals matter, what the timing constraints are. emb-agent fixes this by putting all that hardware knowledge into files inside your repo.

Once the hardware truth is written down, the AI reads it automatically at the start of every session. No more re-explaining your board setup in chat.

emb-agent works with **Claude Code**, **Codex**, and **Cursor**. The same `.emb-agent/` folder drives all three.

### What you get

| Feature | How it helps |
|---|---|
| **Hardware truth files** | Write your MCU model, package, pins, and peripherals once in `.emb-agent/hw.yaml`. The AI reads them every session. |
| **Requirements file** | Keep project goals, interfaces, and constraints in `.emb-agent/req.yaml` so the AI knows what you're building. |
| **Simple command flow** | Most projects run `scan → plan → do → verify`. Shortcuts like `emb-agent scan` / `debug` / `do` skip the `capability run` prefix. |
| **Built-in task tracking** | Tasks are created with `task add`, tracked in `.emb-agent/tasks/`, and linked to worktrees and PRs. |
| **Document ingestion** | Feed in datasheets and schematics — AI extracts chip facts using MinerU (auto-fallback from agent to v4 API). |
| **Chip-specific logic** | PWM, timer, ADC, comparator calculators live in generated adapters with machine-searchable register params. |
| **Built-in verification** | Every task closes with `review → verify`, not just "code compiles and looks right." |
| **Knowledge graph + Wiki** | Auto-generated graph connects chips, registers, formulas, and tasks. Wiki pages auto-populate stubs on graph build. |
| **Auto-startup** | SessionStart hook injects project state automatically. Statusline shows hardware state, task count, wiki pages, graph freshness. |
| **Reply language** | `--lang zh` flag sets the AI's reply language in AGENTS.md. |

### Supported AI tools

| Platform | Where it installs | Auto-startup | Activity tracking |
|---|---|---|---|
| **Claude Code** | `~/.claude/` or `.claude/` | ✅ | ✅ |
| **Codex** | `~/.codex/` or `.codex/` | ✅ | ✅ |
| **Cursor** | `~/.cursor/` or `.cursor/` | ✅ | ✅ |

---

## Quick Start

### 1. Install into your project

```bash
npx emb-agent
```

This opens an interactive installer. It asks which AI tool you use, then sets everything up. For a one-command install with Claude Code:

```bash
npx emb-agent --claude --local --developer "Your Name" --lang zh
```

### 2. Open a new session

Start a new session in your AI tool. emb-agent automatically injects the project context — you don't need to run any command. On the first session, it initializes the project and tells you what to do next.

### 3. Tell it about your hardware

**If you know your MCU:**
```bash
declare hardware --mcu SC8F072 --package SOP8
bootstrap run --confirm
next run
```

**If you haven't chosen a chip yet:**
```text
Describe your goals and constraints in .emb-agent/req.yaml, then run "next"
```

**If the truth is in a datasheet or schematic:**
```bash
ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware
# or for schematics
ingest schematic --file schematic.pdf
```

**Capability shortcuts (after bootstrap):**
```bash
emb-agent scan      # analyze / triage
emb-agent plan      # plan the approach
emb-agent do        # implement (needs active task)
emb-agent debug     # debug / investigate
emb-agent review    # code review
emb-agent verify    # close and verify
```

[Full onboarding guide →](./docs/quick-start.md)

---

## What the installer creates

```text
your-project/
├── AGENTS.md                    ← AI reads this on session start
├── .emb-agent/
│   ├── project.json             ← project settings
│   ├── hw.yaml                  ← chip model, pins, signals, peripherals
│   ├── req.yaml                 ← goals, interfaces, acceptance rules
│   ├── graph/                   ← auto-generated knowledge graph
│   ├── wiki/                    ← long-term knowledge storage
│   ├── tasks/                   ← task definitions and context
│   ├── specs/                   ← project-specific workflow rules
│   └── formulas/                ← chip formula registries
└── .claude/  (or .codex/, .cursor/)
    ├── settings.json             ← hooks (auto-injected)
    ├── commands/emb/             ← slash commands like /emb:next
    └── agents/                   ← specialized agents (emb-fw-doer, etc.)
```

---

## Automating with emb-agent

If you're building scripts or tooling around emb-agent, use these machine-readable surfaces:

| Command | Returns |
|---|---|
| `next --brief` | Compact JSON with the recommended next action |
| `external status` | Stable envelope with project health summary |
| `external health` | Hardware and workflow health report |
| `task worktree status` | Status of isolated task workspaces |

Every response includes a **runtime event** level (`clear`, `ok`, `pending`, `blocked`, `failed`) that tells your script whether it's safe to proceed.

---

## How it's built

emb-agent has three layers:

1. **Workflow layer** — the commands you run: `start`, `declare hardware`, `next`, `task`, `ingest`. These guide the AI through hardware-first development.
2. **Chip-support layer** — chip-specific formulas, register maps, and tool logic. Kept separate so the core stays lean.
3. **Host layer** — skills, hooks, and commands that adapt emb-agent to Claude Code, Codex, or Cursor.

When chip support shows up in a report, it's labeled by readiness:
- `reusable` — ready for any project using that chip
- `reusable-candidate` — nearly ready, needs review
- `project-only` — keep it local for now

---

## More docs

- [Quick Start](./docs/quick-start.md)
- [Platform-specific Setup](./docs/platforms.md)
- [Real-world Scenarios](./docs/scenarios.md)
- [What Belongs Where](./docs/product-boundaries.md)
- [Chip Support Model](./docs/chip-support-model.md)
- [Task Lifecycle](./docs/task-model.md)
- [Automation Output Format](./docs/automation-contract.md)
- [Workflow Customization](./docs/workflow-layering.md)
- [Full Command Reference](./commands/emb/help.md)
- [Release Notes](./RELEASE.md)

---

<p align="center">
  <sub>MIT · <a href="https://www.npmjs.com/package/emb-agent">npm</a> · <a href="./README.zh.md">中文文档</a></sub>
</p>
