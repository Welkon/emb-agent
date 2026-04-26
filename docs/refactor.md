# Refactor

This document is the current entry point for the generator-first refactor.

## Direction

`emb-agent` is a template and workflow generator with a runtime execution layer.
The architecture should route user work through capabilities first, then decide which
generated or runtime surface should execute the work.

The target is not a repository-local `skills/` directory as the center of the system.
Host-visible skills can be generated surfaces, but workflow capabilities exist before
any host-specific skill files are materialized.

## Delivered Shape

- `capability list`, `capability show`, `capability run`, and `capability materialize`
  are the primary capability-facing CLI surface.
- Workflow actions such as `scan`, `plan`, `do`, `debug`, `review`, `verify`,
  `note`, and `arch-review` are catalogued as workflow capabilities.
- Bare workflow action commands are no longer duplicated entries. Use
  `capability run <name>` for workflow execution.
- `init` and `workflow init` materialize project-local workflow assets under
  `.emb-agent/specs`, `.emb-agent/templates`, and `.emb-agent/registry`.
- Capability routing metadata is exposed to JSON, brief, external, dispatch, and
  status consumers without requiring a repository-local `skills/` directory.

## Design Contract

The routing path is:

1. Resolve intent to a capability.
2. Attach generator-first route metadata.
3. Materialize workflow specs/templates when project-local structure is needed.
4. Execute through the capability runtime or generated host surface.

Command-first admin surfaces can remain, but workflow work must enter through
capabilities rather than duplicated top-level action commands.

## Related Document

See `docs/skill-first-refactor.md` for the longer historical analysis that led to
the capability-first correction.
