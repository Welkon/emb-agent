# emb-agent

**Embedded firmware workflow engine for AI coding assistants.**

Put your chip specs, pin assignments, and hardware constraints into `.emb-agent/` — the AI reads them automatically every session. No more re-explaining your board setup.

Works with **Pi** (native extension), **Codex**, **Claude Code**, and **Cursor**.

---

## Architecture

```
emb-agent-rs (Rust)         ← All logic lives here
    ↑
emb-agent.cjs (59 lines)    ← Thin Node.js pass-through
    ↑
Host extensions/hooks       ← Pi extension, Codex hooks.json, Cursor commands
    ↑
AI assistant                ← /emb:next, /emb:task, /emb:schematic...
```

## Commands

```bash
# Session
emb-agent-rs start next status health pause resume

# Tasks
emb-agent-rs task list/show/add/activate/resolve
emb-agent-rs task aar scan/record      # After Action Review

# Schematic analysis
emb-agent-rs schematic summary/components/nets/bom/advice/preview/raw
emb-agent-rs ingest schematic --file board.SchDoc
emb-agent-rs ingest board --file board.PcbDoc

# Knowledge & memory
emb-agent-rs knowledge graph refresh/report/query/explain
emb-agent-rs knowledge wiki
emb-agent-rs memory list/remember

# Lookup
emb-agent-rs doc lookup --chip CA51M550
emb-agent-rs component lookup
emb-agent-rs board summary

# Workflow
emb-agent-rs scan plan do review verify debug
emb-agent-rs chip diff --from X --to Y
emb-agent-rs variant list/create/fork/diff
```

## Supported AI Tools

| Platform | Integration | Auto-startup |
|----------|------------|--------------|
| **Pi** | `.pi/extensions/emb-agent.ts` + `/emb:` slash commands | ✅ |
| **Codex** | `.codex/hooks.json` → Rust binary | ✅ |
| **Claude** | `.claude/commands/emb/` markdown commands | ✅ |
| **Cursor** | `.cursor/commands/emb/` markdown commands | ✅ |

## Project Structure

```
your-project/
├── .emb-agent/
│   ├── project.json             # Project config
│   ├── hw.yaml                  # MCU model, pins, signals, peripherals
│   ├── req.yaml                 # Goals, interfaces, constraints
│   ├── graph/                   # Auto-generated knowledge graph
│   ├── wiki/                    # Long-term knowledge
│   ├── tasks/                   # Task tracking
│   ├── cache/schematics/        # Parsed schematic cache
│   └── cache/docs/              # Parsed document cache
└── .<host>/
    └── emb-agent/
        ├── bin/emb-agent-rs     # Rust binary
        └── bin/emb-agent.cjs    # Thin wrapper
```

## Install

```bash
cd emb-agent
cargo build --release
cp target/release/emb-agent-rs .<host>/emb-agent/bin/
cp runtime/bin/emb-agent.cjs .<host>/emb-agent/bin/
```

## Build

```bash
cargo build --release
cargo test --workspace
```

## License

MIT
