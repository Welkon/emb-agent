# Quick Start

This is the shortest recommended path for getting emb-agent running in a real embedded repository.

## 1. Install into the repo

```bash
npx emb-agent
```

The installer will guide you through runtime selection and local setup. It also creates `AGENTS.md`, bootstraps `.emb-agent/`, and installs host startup automation for the selected runtime.

Use `--profile workflow` only if you are authoring scaffold assets rather than using emb-agent day to day.

## 2. Open a session

emb-agent injects the startup context automatically when the session opens. On the first run it initializes the repo automatically, then tells you the shortest next step.

Use `start` only when you want to re-render that entry context manually.

Do not treat a shared adapters repository as required setup before you can begin. The default flow should work inside the current project first.

## 3. If the MCU is already known

Write the hardware truth directly:

```bash
declare hardware --mcu SC8F072 --package SOP8
bootstrap run --confirm
next run
```

If you already know signals or peripherals, record them with additional `declare hardware` flags instead of re-explaining them in chat.

If you want direct control over chip-support registration/install, use `support bootstrap` instead of splitting `support source add` and `support sync` manually.

Shared chip-support sources are the reuse layer. They are useful when support is already available or ready to be shared, but they are not the default entrypoint for a new project.

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

For multi-page schematics exported as separate sheets, repeat `--file` for each sheet. emb-agent will emit both `parsed.json` and `analysis.visual-netlist.json` so the agent can review cross-sheet nets and dangling nets before writing hardware truth.

Review the result, apply staged truth if needed, then return to `next`.

If `health` or `next` starts talking about chip support after document ingest, prefer this path:

```text
ingest doc -> apply truth -> adapter analysis init -> let the agent fill the analysis artifact -> adapter derive --from-analysis -> next
```

Do not treat `ingest doc` as if it already produced final chip support. It only stages facts and hands off to the analysis-artifact flow.

If the derived support is only good enough for the current repository, keep it local first. Promote it into a shared adapters catalog only after review confirms it is reusable.

## 6. Keep the default flow small

The public command surface is intentionally small:

- Start / route: `start`, `ingest`, `next`, `task`
- Execute: `capability run scan`, `capability run plan`, `capability run do`, `capability run debug`
- Close: `capability run review`, `capability run verify`, `pause`, `resume`

If you want the full installed surface, use `help advanced` or `help --all`.

## 7. See the specialized docs only when needed

- Platform-specific setup: [platforms.md](./platforms.md)
- Support-layer boundaries: [product-boundaries.md](./product-boundaries.md)
- Project-local workflow extensions: [workflow-layering.md](./workflow-layering.md)
