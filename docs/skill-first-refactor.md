# Capability-First / Generator-First Refactor

## Why

`emb-agent` already has a real skill runtime. It can:

- discover skills from built-in directories and installed plugins
- execute skills inline, as command skills, or through an isolated host bridge
- provision plugin-local runtime dependencies
- record skill execution diagnostics in session state

Before this refactor, the top-level product shape was command-first:

- `emb-agent-main.cjs` composes the system around command groups, command routing, and state commands
- `state-commands.cjs` exposes `skills` as one command family among many
- action flows such as `scan`, `plan`, `do`, `review`, and `verify` were routed as first-class commands

This creates a split brain:

1. Skills are presented as the user-visible capability unit.
2. Commands still own the main orchestration path.

Trellis beta is useful here because it makes one architectural decision very explicit: route by intent first, then load the right skill or sub-agent with the right context. We should copy that decision, not the entire Trellis filesystem model.

## Generator-First Correction

emb-agent should also be treated as a **template and workflow generator**, not only as a long-lived runtime shell.

That means:

- repository-local `skills/` directories are not the architectural center
- capabilities can exist before any host-specific skill file is materialized
- host-visible skills, agents, hooks, workflow specs, and templates should be viewed as generated or synchronized surfaces

So the real target is:

- capability-first routing
- generated host surfaces where useful
- runtime compatibility where generation is not needed yet

## Delivered So Far

Phase 1 is intentionally metadata-first. It does not change execution semantics yet.

- Added a `capability_route` schema that treats emb-agent as a template/workflow generator plus runtime compatibility layer.
- `next`, `dispatch`, and action outputs now expose generator-first routing metadata.
- `status` now exposes both the current runtime surface route and the recommended `next_capability_route`.
- `external` and brief outputs can now surface the same routing model to host automation without assuming a repository-local `skills/` directory.

## Current Read

### What is already strong

- Skill discovery and plugin packaging are not toy implementations.
- The runtime already supports isolated skill execution with a host sub-agent bridge.
- Skills already have metadata such as description, `when_to_use`, `allowed_tools`, hooks, evidence hints, and execution mode.
- The runtime already knows how to materialize host-visible skill entries under `.codex/skills/` and shared `.agents/skills/`.

### What was command-first

- The CLI router was organized around verbs like `next`, `scan`, `plan`, `do`, `review`, `verify`, `support`, `adapter`, `tool`, and `task`.
- Command groups own workflow gating, task-intake blocking, health gating, and action-card generation.
- Skill execution is mostly an explicit subcommand, not the default routing primitive.
- Workflow guidance lives more in runtime code and command outputs than in reusable skill contracts.

### Resulting product problem

The user has to know the command graph first, then optionally use skills. That is backwards for an extensible agent runtime.

For end-user work, the primary question should be:

> "What capability or workflow am I invoking?"

Not:

> "Which command family do I need to remember?"

## Target

Make **capability/workflow** the primary routing unit for user-facing work.

Skill remains important, but as a host-visible surface that may be generated from the workflow layer rather than a repository-local directory requirement.

Commands remain, but with narrower roles:

- generated host surfaces
- low-level admin and maintenance surfaces
- explicit runtime and platform operations

The target is **not** "everything becomes a repository-local skill". The target is:

- user intent -> capability/workflow route
- capability/workflow -> context pack
- context pack -> executor

## Non-Goals

- Do not remove the current CLI in phase 1.
- Do not break `external` protocol payloads.
- Do not force every skill to use a sub-agent.
- Do not clone Trellis task/spec layout mechanically.
- Do not move chip support, tool registry, or permission gates into Markdown skills.

## Proposed Architecture

### 1. Intent Router

Add a first-class routing layer that answers:

- what skill should handle this request
- whether the route is direct, advisory, or ambiguous
- whether a task is required before execution
- what execution mode is preferred

Suggested module:

- `runtime/lib/skill-router.cjs`

Suggested inputs:

- raw user intent or command alias
- current session state
- active task state
- project profile
- health and permission state

Suggested outputs:

- `skill`
- `reason`
- `confidence`
- `required_context`
- `recommended_executor`
- `primary_entry`

### 2. Skill Contract Layer

Today a skill mostly carries discovery and execution metadata. The contract should grow to include routing and workflow semantics.

Suggested additional frontmatter fields:

- `triggers`
- `intent_aliases`
- `requires_task`
- `workflow_phase`
- `recommended_executor`
- `produces_artifacts`
- `required_inputs`
- `quality_gates`
- `side_effect_level`
- `route_priority`

This turns a skill from "loadable content" into "routable capability".

### 3. Context Pack Builder

Trellis beta wins because the right context is assembled before implementation. We should do the same, but using emb-agent primitives.

Add a context builder that assembles skill-scoped inputs from:

- active task and PRD state
- project profile and workflow state
- selected specs or instruction layers
- memory layers
- health and permission gates
- hardware truth and tool recommendations
- prior skill diagnostics

Suggested module:

- `runtime/lib/skill-context.cjs`

Output shape should be machine-oriented, not prose-only. The executor can still render prose from it.

### 4. Executor Layer

Skills should not imply one execution strategy. A routed skill can execute through one of several backends:

- `inline`
- `command`
- `isolated`
- `subagent`
- `tool-first`
- `workflow-only`

This part largely exists already in `skill-runtime.cjs`; the refactor is mostly about moving executor choice behind routing instead of making the user call `skills run` manually.

### 5. Command Surface Layer

Existing commands should become one of three things:

1. **Admin commands**
   Keep command-first.

   Examples:
   - `skills install`
   - `skills enable`
   - `skills disable`
   - `skills remove`
   - `memory *`
   - `settings *`
   - `workflow *`
   - `scaffold *`
   - `adapter publish`
   - `adapter export`

2. **Removed duplicated workflow entries**
   Do not keep bare workflow commands as parallel entries.

   Examples:
   - `capability run scan`
   - `capability run plan`
   - `capability run do`
   - `capability run review`
   - `capability run verify`

3. **Low-level executor commands**
   Keep command-first because they are operational building blocks rather than user workflows.

   Examples:
   - `tool run`
   - `executor run`
   - `external *`

## What We Should Copy From Trellis Beta

- Intent-first routing
- "Do not skip the skill" discipline
- Context assembled before execution, not remembered ad hoc in chat
- Sub-agent execution as a backend of the workflow, not the workflow definition itself
- Explicit separation between planning context and implementation context

## What We Should Not Copy Blindly

- A repo-wide `.trellis/` clone
- JSONL context files as the only context mechanism
- A platform-specific workflow model that ignores emb-agent runtime abstractions
- Treating skills as pure documentation without runtime contracts

Our differentiator is still:

- runtime-host integration
- chip/tool/support workflows
- permission and health gating
- executable skill plugins with local runtimes

## Migration Strategy

### Phase 0: Freeze the boundary

Before changing behavior, document which commands are:

- user workflow entrypoints
- admin surfaces
- executor surfaces

Deliverable:

- a stable mapping table from command -> target role

### Phase 1: Introduce routing without changing UX

Add:

- `skill-router.cjs`
- routing metadata on skills
- tests for route resolution

Behavior:

- existing commands keep working
- `next` can start emitting `recommended_skill`
- `dispatch` can include `skill_route`

This phase proves the model without breaking the CLI.

### Phase 2: Flip `next` and action guidance to skill-first

Change high-level guidance so the system recommends:

- `skills run <name>`
- or an auto-routed skill execution payload

instead of leading with raw action commands for user-facing flows.

This is the first visible product shift.

### Phase 3: Convert action commands into capability entries

Rework workflow actions so `capability run <name>` is the execution entry:

- resolve a skill route first
- assemble a context pack
- execute through the selected backend
- preserve current output contracts where needed

Bare command names do not remain as parallel workflow entries.

### Phase 4: Move workflow policy out of command groups

Gradually migrate workflow policy from command-specific branches into reusable skill/workflow contracts:

- task requirement checks
- health gating
- permission gating hints
- evidence expectations
- recommended next steps

`command-groups.cjs` should shrink after this phase.

### Phase 5: Optional default auto-routing entrypoint

Once routing is stable, add a default entrypoint that accepts plain intent and resolves the right skill automatically.

Examples:

- `emb-agent route "review this driver refactor"`
- future host hook integration that calls route resolution directly

This should happen only after compatibility behavior is stable.

## First Concrete Slice

Do this first. It is the smallest change that proves the direction.

1. Add routing metadata support to `skill-runtime.cjs`.
2. Add `skill-router.cjs` with deterministic route resolution.
3. Teach `next` and `dispatch next` to emit `recommended_skill` alongside existing command guidance.
4. Add tests for:
   - exact skill match
   - multiple candidate skills
   - task-required skills with no active task
   - command alias fallback
5. Keep the workflow behavior unchanged while moving invocation to `capability run <name>`.

If this first slice feels awkward, the full refactor is probably wrong. If it feels clean, then phase 3 is justified.

## Working Rule

For emb-agent, **Skill-first** should mean:

- workflow capabilities are modeled as skills
- context is assembled for the skill before execution
- commands are adapters and operators, not the primary mental model

That is the refactor worth doing.
