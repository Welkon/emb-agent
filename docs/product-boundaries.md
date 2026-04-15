# Product Boundaries

emb-agent can feel larger than a narrow embedded runtime because this repository carries several layers.

The useful split is not "core vs miscellaneous", and it is also not "multiple unrelated products". It is:

- embedded workflow
- support layers
- chip support

emb-agent is still one product, and it is primarily for embedded work.

## Embedded Workflow

The embedded workflow is the part most firmware users should feel first.

It owns:

- project truth such as `.emb-agent/hw.yaml`, `.emb-agent/req.yaml`, and `.emb-agent/project.json`
- the default session flow: `init`, `declare hardware`, `next`, `scan`, `plan`, `do`, `debug`, `review`, `verify`
- task/session continuity
- document ingestion and truth promotion
- abstract routing contracts for chip- and tool-specific work

This is the part that should stay small, stable, and easy to explain.

If a user only wants to onboard an MCU repository, recover hardware truth, ingest datasheets, and execute firmware work, this layer should be enough.

## Support Layers

The support layers exist to make that embedded workflow more reliable over long sessions and repeated project setups.

It includes:

- reusable runtime skills surfaced by `skills list/show/run`
- scaffold trees for skills, hooks, shells, and protocol blocks
- thin shell entry files such as `AGENTS.md`, `CODEX.md`, `CLAUDE.md`, and `GEMINI.md`
- SessionStart reinjection hooks
- workflow/spec/template layers used to author project-local extensions or higher-level agent behavior

These are valuable, but they are not a separate product and they are not the default mental model for every firmware user.

If the repository feels like it is doing too many things at once, it is usually because the embedded workflow and its support layers are both visible at the same time.

## Chip Support

Chip support is a third boundary, not a subsection of support layers.

It owns:

- family/device/chip-specific formulas
- route bindings and executable tool algorithms
- chip profiles, package details, and derived hardware constraints

The embedded workflow should stay abstract. Chip support should absorb vendor- and chip-specific logic. See [Chip Support Model](./adapter-model.md).

## What Should Dominate The Default Path

For most users, the first path should stay:

1. install into the host runtime
2. `init`
3. `declare hardware`
4. `next`
5. follow `scan/plan/do/debug/review/verify`

The following should remain explicitly secondary:

- scaffold authoring
- shell authoring
- hook authoring
- protocol-block maintenance
- skill-library design

Those are support-layer concerns. They matter when you are extending emb-agent itself or building reusable workflow infrastructure, not when you are just trying to move a firmware project forward.

## Why This Matters

Without this layering, emb-agent can read like a grab-bag:

- embedded runtime
- workflow engine
- skill system
- scaffold generator
- hook pack
- harness integration layer

The intended interpretation is:

- embedded workflow solves project truth and session flow
- support layers keep long-running agent setups structurally consistent
- chip support isolates chip/tool specificity

That is still one embedded product, but only if the layers stay explicit in docs, help, and command posture.
