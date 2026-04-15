# Quick Start

This is the shortest recommended path for getting emb-agent running in a real embedded repository.

## 1. Install into the repo

```bash
npx emb-agent --codex --local --developer your-name
```

Replace `--codex` with `--claude` or `--cursor` for the host you actually use.

For hostless external-agent setups, use:

```bash
npx emb-agent --external --local --developer your-name
```

This installs the runtime under `.emb-agent/runtime` and generates `.emb-agent/external-agent.md` for external driver loops.

If the caller is a generic external agent, prefer the fixed driver protocol commands:

```bash
node ./.emb-agent/runtime/bin/emb-agent.cjs external start
node ./.emb-agent/runtime/bin/emb-agent.cjs external init --runtime external --user your-name
node ./.emb-agent/runtime/bin/emb-agent.cjs external next
node ./.emb-agent/runtime/bin/emb-agent.cjs external health
node ./.emb-agent/runtime/bin/emb-agent.cjs external dispatch-next
```

Use `--profile workflow` only if you are authoring scaffold assets rather than using emb-agent day to day.

For Codex, hooks may still require manual enablement in `~/.codex/config.toml`. See [platforms.md](./platforms.md).

## 2. Open a session and run `start`

```bash
start
```

`start` is the single repository entrypoint. It tells you whether the shortest path is `resume`, a bootstrap step, `task add`, or `next`.

## 3. If the MCU is already known

Write the hardware truth directly:

```bash
declare hardware --mcu SC8F072 --package SOP8
next
```

If you already know signals or peripherals, record them with additional `declare hardware` flags instead of re-explaining them in chat.

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

- Start: `start`, `init`, `ingest`, `next`, `task`
- Execute: `scan`, `plan`, `do`, `debug`
- Close: `review`, `verify`, `pause`, `resume`

If you want the full installed surface, use `help advanced` or `help --all`.

## 7. See the specialized docs only when needed

- Platform-specific setup: [platforms.md](./platforms.md)
- Support-layer boundaries: [product-boundaries.md](./product-boundaries.md)
- Project-local workflow extensions: [workflow-layering.md](./workflow-layering.md)
