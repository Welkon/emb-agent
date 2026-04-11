# Quick Start

This is the shortest recommended path for getting emb-agent running in a real embedded repository.

## 1. Install into a supported runtime

For Codex:

```bash
npx emb-agent --codex --global --developer your-name
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
npx emb-agent --claude --global --developer your-name
```

`--developer` is required during install. The value is stored in runtime config and reused by `init`.

## 2. Open the project in Codex or Claude Code

Use emb-agent from inside the session.

These are session commands. You do not need to run internal runtime files manually.

## 3. Add project-local workflow extensions when needed

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

Use this for vertical product logic such as pillbox adherence flow, SKU-specific factory branching, or customer-specific device/app/cloud behavior.

See [Workflow Layering](./workflow-layering.md) for the layering rule and [Smart Pillbox Project Extension](../examples/project-extensions/smart-pillbox/README.md) for a concrete example.

## 4. Initialize the project

Inside the session:

```bash
init
```

This prepares:

- `.emb-agent/project.json`
- `.emb-agent/hw.yaml`
- `.emb-agent/req.yaml`
- starter docs and checklists

## 5. Lock hardware truth early

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

## 6. Continue from the default command

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

## 7. Use advanced runtime surfaces only when they add leverage

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

## 8. Pull truth out of documents only when needed

If the answer still lives in a datasheet or manual:

```bash
ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware
```

Use `declare hardware` first when the answer is already known and only needs to be written down.
