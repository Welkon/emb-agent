# Release Guide

This document defines the minimum release closure for `emb-agent` and `emb-agent-adapters`.

## Repository Roles

- `emb-agent` owns installer logic, runtime behavior, commands, agents, and abstract tool/chip contracts.
- `emb-agent-adapters` owns family/device/chip profiles, routes, and algorithms that consume the runtime contracts.

## Release Order

When adapter changes depend on new runtime contracts, release in this order:

1. Release `emb-agent`.
2. Release `emb-agent-adapters`.
3. Perform a fresh install and `adapter sync` verification pass.

## Pre-Release Checks

For `emb-agent`:

- Validate key `package.json` fields.
- Run the full test suite.
- Run `npm pack --dry-run`.
- Ensure the working tree is clean before tagging or publishing.

For `emb-agent-adapters`:

- Validate route / algorithm / profile structure.
- Validate device-profile bindings.
- Validate that every referenced route and algorithm exists.

## Final Validation

After both repositories move together, verify at least one real chip flow end to end, including runtime install, adapter sync, and one runnable tool call.
