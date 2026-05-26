# emb-agent

<p align="center">
  <strong>AI-Driven Embedded Firmware Workflow</strong><br>
  <sub>Write your hardware truth once. The AI reads it every session.</sub>
</p>

<br>

```
                                You
                                 │
                    "实现 PWM 调光，低功耗"
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │          AI  Coding  Assistant        │
              │   Pi  ·  Codex  ·  Claude  ·  Cursor │
              │                                      │
              │   Already knows:                     │
              │   • Your MCU model and package        │
              │   • Pin assignments                   │
              │   • Peripheral configuration          │
              │   • Active tasks and priorities       │
              │   • Schematic topology and nets       │
              └──────────────┬───────────────────────┘
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
           /emb:next   /emb:task   /emb:schematic
                │            │            │
                └────────────┼────────────┘
                             ▼
              ┌──────────────────────────────────────┐
              │           emb-agent-rs               │
              │            Pure Rust                  │
              │                                      │
              │  ┌────────┐ ┌────────┐ ┌──────────┐ │
              │  │Session │ │  Task  │ │Schematic │ │
              │  │────────│ │────────│ │──────────│ │
              │  │ start  │ │ list   │ │ summary  │ │
              │  │ next   │ │ add    │ │ nets     │ │
              │  │ status │ │ resolve│ │ bom      │ │
              │  └────────┘ └────────┘ └──────────┘ │
              │                                      │
              │  ┌────────┐ ┌────────┐ ┌──────────┐ │
              │  │  Chip  │ │ Graph  │ │ Workflow │ │
              │  │────────│ │────────│ │──────────│ │
              │  │ diff   │ │refresh │ │ scan     │ │
              │  │ swap   │ │ query  │ │ plan  do │ │
              │  └────────┘ └────────┘ │ verify   │ │
              │                        └──────────┘ │
              └──────────────┬───────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────────────┐
              │           .emb-agent/                │
              │                                      │
              │  hw.yaml     Chip · Pins · Periph    │
              │  req.yaml    Goals · Constraints     │
              │  tasks/      Active work tracking    │
              │  graph/      Knowledge graph         │
              │  wiki/       Long-term memory        │
              │  cache/      Parsed schematics/docs  │
              └──────────────────────────────────────┘
```

<br>

## How It Works

**You describe your hardware once.** Chip model, pin assignments, peripheral config — written into `.emb-agent/hw.yaml` and `.emb-agent/req.yaml`.

**Every session after that, the AI already knows your board.** No re-explaining. No "what MCU are you using?" on repeat.

**You say what you need. The AI routes it.** From schematic analysis to chip comparison to peripheral bringup — the right tool fires for the right job.

**Knowledge builds up over time.** Every analysis, every lesson learned, every datasheet lookup feeds the knowledge graph. The AI gets smarter about *your* project.

---

## The Flow

<p align="center">
  <strong>Start</strong> → AI discovers your project<br>
  <strong>Lock</strong> → Hardware truth confirmed<br>
  <strong>Work</strong> → Tasks route automatically<br>
  <strong>Learn</strong> → Knowledge accumulates<br>
  <strong>Close</strong> → Verify & record lessons<br>
</p>

---

## Install

```bash
git clone <repo> && cd emb-agent && cargo build --release
cp target/release/emb-agent-rs your-project/.<host>/emb-agent/bin/
cp runtime/bin/emb-agent.cjs      your-project/.<host>/emb-agent/bin/
```

Supports **Pi**, **Codex**, **Claude Code**, and **Cursor**.

---

<p align="center">
  <sub>
    <a href="./README.zh.md">中文</a> ·
    <a href="docs/scenarios.md">Scenarios</a> ·
    <a href="docs/task-model.md">Task Model</a> ·
    <a href="docs/chip-support-model.md">Chip Support</a> ·
    <a href="commands/emb/help.md">Commands</a>
  </sub>
</p>

<p align="center">
  <sub>MIT</sub>
</p>
