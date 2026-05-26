# emb-agent

<p align="center">
  <strong>AI-driven embedded firmware workflow</strong><br>
  <sub>Put chip specs, pins, and hardware constraints into .emb-agent/ — AI reads them automatically.</sub>
</p>

<p align="center">
  <a href="./README.zh.md">中文</a>
</p>

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   AI Coding Assistant                    │
│         Pi · Codex · Claude Code · Cursor               │
└──────┬──────┬──────┬──────┬──────┬──────┬──────────────┘
       │      │      │      │      │      │
       │  /emb:next  /emb:task  /emb:schematic  ...
       │      │      │      │      │      │
┌──────┴──────┴──────┴──────┴──────┴──────┴──────────────┐
│                  Host Integration                        │
│  Pi: .pi/extensions/emb-agent.ts  ← Native extension    │
│  Codex: .codex/hooks.json          ← Lifecycle hooks     │
│  Cursor/Claude: commands/emb/*.md  ← Command docs        │
└──────────────────────┬──────────────────────────────────┘
                       │  node emb-agent.cjs
                       ▼
┌─────────────────────────────────────────────────────────┐
│              emb-agent.cjs (59 lines)                    │
│              Thin pass-through → Rust binary             │
└──────────────────────┬──────────────────────────────────┘
                       │  spawnSync
                       ▼
┌─────────────────────────────────────────────────────────┐
│              emb-agent-rs (pure Rust)                    │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐ │
│  │ session  │ │  task    │ │ schematic  │ │ hardware │ │
│  │ next     │ │ activate │ │ summary    │ │ chip     │ │
│  │ status   │ │ resolve  │ │ components │ │ board    │ │
│  └──────────┘ └──────────┘ └────────────┘ └──────────┘ │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐ │
│  │knowledge │ │  lookup  │ │  workflow  │ │  hooks   │ │
│  │ graph    │ │ doc      │ │ scan/plan  │ │ session  │ │
│  │ wiki     │ │ component│ │ do/review  │ │ status   │ │
│  └──────────┘ └──────────┘ └────────────┘ └──────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Project Files                          │
│  .emb-agent/hw.yaml       Chip, pins, peripherals       │
│  .emb-agent/req.yaml      Goals, interfaces, constraints│
│  .emb-agent/tasks/        Task tracking                 │
│  .emb-agent/graph/        Knowledge graph               │
│  .emb-agent/wiki/         Long-term knowledge           │
│  .emb-agent/cache/        Parsed cache (schematic/docs) │
└─────────────────────────────────────────────────────────┘
```

## Common Commands

```bash
# Session — AI auto-loads project state
emb-agent-rs next

# Status
emb-agent-rs status

# Tasks
emb-agent-rs task list               # List all tasks
emb-agent-rs task activate pwm-led   # Activate a task
emb-agent-rs task add "Implement touch key"

# Schematic
emb-agent-rs schematic summary       # Overview
emb-agent-rs schematic bom           # BOM table
emb-agent-rs ingest schematic --file board.SchDoc

# Knowledge
emb-agent-rs knowledge graph refresh # Refresh graph
emb-agent-rs knowledge wiki          # List wiki pages

# Workflow
emb-agent-rs scan                    # Analyze current task
emb-agent-rs plan                    # Create plan
emb-agent-rs do                      # Implement
```

**Full reference**: [commands/emb/help.md](commands/emb/help.md)

## Install

```bash
git clone <repo>
cd emb-agent
cargo build --release
```

Deploy to project:
```bash
cp target/release/emb-agent-rs your-project/.pi/emb-agent/bin/
cp runtime/bin/emb-agent.cjs      your-project/.pi/emb-agent/bin/
```

## Docs

| Doc | Topic |
|-----|-------|
| [ai-host-contract.md](docs/ai-host-contract.md) | Host integration protocol |
| [task-model.md](docs/task-model.md) | Task lifecycle |
| [chip-support-model.md](docs/chip-support-model.md) | Chip support model |
| [scenarios.md](docs/scenarios.md) | Usage scenarios |
| [product-boundaries.md](docs/product-boundaries.md) | Product boundaries |
| [automation-contract.md](docs/automation-contract.md) | Automation output format |
| [workflow-layering.md](docs/workflow-layering.md) | Workflow layering |

## License

MIT
