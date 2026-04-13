# Quick Start

This is the shortest recommended path for getting emb-agent running in a real embedded repository.

This guide is intentionally embedded-workflow first. It does not try to teach every scaffold, skill, hook, or support surface on day one.

## 1. Install into a supported runtime

For Codex:

```bash
npx emb-agent --codex --local --developer your-name
```

As of Codex CLI `v0.116.0` on `2026-03-24`, Codex hooks are still experimental. Before using emb-agent in Codex, add this to `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
codex_hooks = true
```

emb-agent does not add these flags automatically. If a future Codex release enables hooks by default, this extra configuration may no longer be needed.

For Claude Code:

```bash
npx emb-agent --claude --local --developer your-name
```

This writes project-scoped Claude assets under `./.claude/`.
`--developer` is required during install. The value is stored in runtime config and reused by `init`.

For Cursor:

```bash
npx emb-agent --cursor --local --developer your-name
```

This writes project-scoped Cursor assets under `./.cursor/`, including `commands/` wrappers and `settings.json` hooks.
`--developer` is required during install. The value is stored in runtime config and reused by `init`.

## 2. Open the project in Codex, Claude Code, or Cursor

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

If the project is still at concept stage and the MCU is not chosen yet:

- leave `.emb-agent/hw.yaml` unknown for now
- record goals, constraints, interfaces, and acceptance in `.emb-agent/req.yaml`
- then run `next`

You do not need to invent a fake MCU just to continue.

## 5. Continue from the default command

```bash
next
```

This keeps command choice minimal. You should not need to memorize the full surface before doing useful work.

The public command surface is intentionally small and grouped like this:

- Start: `init`, `ingest`, `next`, `task`
- Execute: `scan`, `plan`, `do`, `debug`
- Close: `review`, `verify`, `pause`, `resume`

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

This returns staged truth rather than writing `hw.yaml` immediately. Review the parsed result and run the suggested `ingest apply doc ...` step before returning to `next`.

Use `declare hardware` first when the answer is already known and only needs to be written down.

If the board truth still lives in a schematic rather than a datasheet, use:

```bash
ingest schematic --file <path>
```

`ingest schematic` is analysis-only: it prepares normalized artifacts for agent review and does not directly update truth files.

## 7. Use optional support surfaces only when they add leverage

Most embedded projects can ignore this section at first.

The default path should stay short, but advanced runtime surfaces are available when the session gets longer or more repetitive:

```bash
skills list
skills run remember
memory stack
memory audit
```

If your host supports the sub-agent bridge and the work needs real delegation, you can also steer the execution pattern:

```bash
prefs set orchestration_mode swarm
dispatch run plan
```

Use `coordinator` for one primary integrator, `fork` for inherited-context workers, and `swarm` for a flat peer roster.

These are still support surfaces around the same embedded workflow.

If you are looking for skill authoring, shell templates, hooks, or protocol blocks, those are support layers rather than the default embedded-project path. See [Product Boundaries](./product-boundaries.md).

## 8. Add project-local workflow extensions only when the product really needs them

Most projects should skip this section on day one.

If you need a product-specific workflow pack, keep it in the repository instead of pushing it into built-in runtime assets.

Place these under the project before `init`:

- `.emb-agent/registry/workflow.json`
- `.emb-agent/packs/`
- `.emb-agent/specs/`
- `.emb-agent/templates/`

Then initialize with the project-local pack name:

```bash
init --pack <project-local-pack>
```

Use this only for vertical product logic such as SKU-specific factory branching or customer-specific device/app/cloud behavior.

See [Workflow Layering](./workflow-layering.md) for the layering rule and [Smart Pillbox Project Extension](../examples/project-extensions/smart-pillbox/README.md) for a concrete example.
