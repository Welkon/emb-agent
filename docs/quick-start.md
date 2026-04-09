# Quick Start

This is the shortest recommended path for getting emb-agent running in a real embedded repository.

## 1. Install into a supported runtime

For Codex:

```bash
npx emb-agent --codex --global --developer your-name
```

For Claude Code:

```bash
npx emb-agent --claude --global --developer your-name
```

`--developer` is required during install. The value is stored in runtime config and reused by `init`.

## 2. Pick the runtime CLI path

- Codex: `node ~/.codex/emb-agent/bin/emb-agent.cjs`
- Claude Code: `node ~/.claude/emb-agent/bin/emb-agent.cjs`

Examples below use `<runtime-cli>`.

## 3. Initialize the project

Inside the project repository:

```bash
<runtime-cli> init
```

This prepares:

- `.emb-agent/project.json`
- `.emb-agent/hw.yaml`
- `.emb-agent/req.yaml`
- starter docs and checklists

## 4. Lock hardware truth early

If you already know the target MCU and package:

```bash
<runtime-cli> declare hardware --mcu SC8F072 --package SOP8
```

If you already know board-level signals:

```bash
<runtime-cli> declare hardware \
  --signal PWM_OUT --pin PA3 --dir output \
  --peripheral PWM --usage "dimming"
```

This is the preferred path for experienced embedded engineers.

## 5. Continue from the default command

```bash
<runtime-cli> next
```

This keeps command choice minimal. The user should not need to memorize the full surface before doing useful work.

## 6. Pull truth out of documents only when needed

If the answer still lives in a datasheet or manual:

```bash
<runtime-cli> ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware
```

Use `declare hardware` first when the answer is already known and only needs to be written down.
