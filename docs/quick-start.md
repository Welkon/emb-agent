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

## 2. Open the project in Codex or Claude Code

Use emb-agent from inside the session.

These are session commands. You do not need to run internal runtime files manually.

## 3. Initialize the project

Inside the session:

```bash
init
```

This prepares:

- `.emb-agent/project.json`
- `.emb-agent/hw.yaml`
- `.emb-agent/req.yaml`
- starter docs and checklists

## 4. Lock hardware truth early

If you already know the target MCU and package:

```bash
declare hardware --mcu SC8F072 --package SOP8
```

If you already know board-level signals:

```bash
declare hardware \
  --signal PWM_OUT --pin PA3 --dir output \
  --peripheral PWM --usage "dimming"
```

This is the preferred path when the hardware facts are already known.

## 5. Continue from the default command

```bash
next
```

This keeps command choice minimal. You should not need to memorize the full surface before doing useful work.

If you want fewer decisions per step, run:

```bash
next run
```

This directly enters the recommended stage context (`scan/plan/do/debug/review/verify`) for the current session.

For execution and closure, follow this direction:

```bash
scan         # confirm entry and truth source first
plan         # only when scope/risk is not obvious
do|debug     # execute change or debug root cause
review       # structural quality gate
verify       # final closure checklist
```

If your project sets `quality_gates.required_executors` in `.emb-agent/project.json`, keep running the listed `executor run <name>` checks inside the verify loop until they pass.

If your project sets `quality_gates.required_signoffs`, the engineer closes those board-level checks with `verify confirm <name>` or `verify reject <name>`.

## 6. Pull truth out of documents only when needed

If the answer still lives in a datasheet or manual:

```bash
ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware
```

Use `declare hardware` first when the answer is already known and only needs to be written down.
