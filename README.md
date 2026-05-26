# emb-agent

<p align="center">
  <strong>AI-driven embedded firmware workflow</strong><br>
  <sub>Put chip specs, pins, and hardware constraints into .emb-agent/ — AI reads them automatically.<br>No more re-explaining your board setup every session.</sub>
</p>

<p align="center">
  <a href="./README.zh.md">中文</a>
</p>

---

## How it works

```
You write your hardware truth once:

  .emb-agent/hw.yaml   →  MCU: CA51M550, Package: SOP8
                          Pins: LED-W→P0.2, TOUCH→P0.3, PWM→P0.4
  .emb-agent/req.yaml  →  Dual-channel LED dimmer, touch key input
                          Battery powered, deep sleep support

The AI reads it automatically at session start.
No more "what chip are you using?" every conversation.
```

```
┌──────────────────────────────────────────────────────────┐
│                     AI Assistant                          │
│          Pi · Codex · Claude Code · Cursor               │
│                                                          │
│    You say: "帮我实现PWM调光"  →  AI already knows:        │
│    • Chip is CA51M550 SOP8                                │
│    • PWM output is P0.2                                   │
│    • LED is driven via NMOS Q1                            │
│    • 3 tasks pending, pwm-led is P0 priority              │
└──────┬───────────────────────────────────────────────────┘
       │
       │  /emb:next  /emb:task  /emb:schematic
       ▼
┌──────────────────────────────────────────────────────────┐
│              emb-agent-rs (pure Rust)                     │
│                                                          │
│  Reads .emb-agent/  →  Injects context  →  Routes tasks  │
│                                                          │
│  session  │  task  │  schematic  │  knowledge  │  hooks  │
└──────────────────────────────────────────────────────────┘
```

## The workflow

### 1. Project starts — AI figures out what you have

Open a new session in Pi/Codex/Claude/Cursor. emb-agent scans your repo, detects hardware docs, schematics, and existing code, then asks:

> *"I found CA51M550 datasheet and a SchDoc schematic. Should I ingest them and confirm the MCU?"*

### 2. Hardware truth is locked in

Once the MCU, pins, and peripherals are confirmed, they go into `.emb-agent/hw.yaml`. After that, every session starts with the AI already knowing your board.

### 3. You describe what you want — AI routes to the right task

```
You: "帮我写PWM调光驱动"
AI:  Activates task pwm-led, scans the schematic, checks pin P0.2/PWM0 config,
     reads the CA51M550 datasheet for PWM registers, then writes the driver.
```

```
You: "检查下原理图有没有问题"
AI:  Reads the cached schematic analysis, shows 31 components,
     20 nets, 18 advisory findings — highlights the LED polarity concern.
```

### 4. Knowledge accumulates

Every schematic analysis, datasheet lookup, and debugging insight auto-populates the knowledge graph. Wiki pages grow as the project evolves. The AI gets smarter over time about *your specific project*.

### 5. Tasks close with proper review

Every task goes through `scan → plan → do → review → verify` with After Action Review recording lessons learned. No "it compiles, ship it" — real embedded verification.

---

## Install

```bash
git clone <repo> && cd emb-agent
cargo build --release
cp target/release/emb-agent-rs your-project/.<host>/emb-agent/bin/
cp runtime/bin/emb-agent.cjs      your-project/.<host>/emb-agent/bin/
```

Supports Pi, Codex, Claude Code, and Cursor.

---

## Docs

| Doc | Topic |
|-----|-------|
| [scenarios.md](docs/scenarios.md) | Real-world workflows |
| [task-model.md](docs/task-model.md) | How tasks work |
| [chip-support-model.md](docs/chip-support-model.md) | Chip adapter model |
| [ai-host-contract.md](docs/ai-host-contract.md) | Host integration |
| [commands/emb/help.md](commands/emb/help.md) | Full command reference |

## License

MIT
