# Quick Start

This is the shortest recommended path for getting emb-agent running in a real embedded repository.

## 1. Install into the repo

```bash
npx emb-agent
```

The installer will guide you through runtime selection and local setup. It also creates `AGENTS.md` and bootstraps `.emb-agent/`.

Use `--profile workflow` only if you are authoring scaffold assets rather than using emb-agent day to day.

For Codex, hooks may still require manual enablement in `~/.codex/config.toml`. See [platforms.md](./platforms.md).

## 2. Open a session and run `start`

```bash
start
```

Start with `start`. On the first run it initializes the repo automatically, then tells you the shortest next step.

## 3. If the MCU is already known

Write the hardware truth directly:

```bash
declare hardware --mcu SC8F072 --package SOP8
bootstrap run --confirm
next run
```

If you already know signals or peripherals, record them with additional `declare hardware` flags instead of re-explaining them in chat.

If you want direct control over chip-support registration/install, use `support bootstrap` instead of splitting `support source add` and `support sync` manually.

When `health` or `next` starts talking about chip support, read the reuse state first:

- `reusable`
- `reusable-candidate`
- `project-only`

## 4. If the MCU is still unknown

- Leave `.emb-agent/hw.yaml` unknown.
- Record goals, constraints, interfaces, and acceptance in `.emb-agent/req.yaml`.
- Run `next`.

Do not invent a placeholder MCU just to move forward.

## 5. If the truth still lives in documents

For a datasheet or manual:

```bash
ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware
```

For a schematic:

```bash
ingest schematic --file <path>
```

Review the result, apply staged truth if needed, then return to `next`.

## 6. Keep the default flow small

The public command surface is intentionally small:

- Start: `start`, `ingest`, `next`, `task`
- Execute: `scan`, `plan`, `do`, `debug`
- Close: `review`, `verify`, `pause`, `resume`

If you want the full installed surface, use `help advanced` or `help --all`.

## 7. See the specialized docs only when needed

- Platform-specific setup: [platforms.md](./platforms.md)
- Support-layer boundaries: [product-boundaries.md](./product-boundaries.md)
- Project-local workflow extensions: [workflow-layering.md](./workflow-layering.md)
