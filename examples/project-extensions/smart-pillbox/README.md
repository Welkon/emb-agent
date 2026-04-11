# Smart Pillbox Project Extension

This example shows how to keep a vertical product workflow out of emb-agent built-ins while still making it first-class inside a real project.

## Files

Copy these into your project before running `init --pack smart-pillbox`:

- `.emb-agent/registry/workflow.json`
- `.emb-agent/packs/smart-pillbox.yaml`
- `.emb-agent/specs/smart-pillbox-focus.md`
- `.emb-agent/templates/medication-flow.md.tpl`

## Why project-local

`smart-pillbox` is product-specific. It encodes adherence logic, reminder semantics, and device/app/cloud behavior that are not generic to most embedded projects.

That makes it a better fit for a project-local workflow extension than a built-in runtime pack.

## Result

Once these files exist in the project:

- `init --pack smart-pillbox` can seed `docs/MEDICATION-FLOW.md`
- the `smart-pillbox-focus` spec can auto-inject
- built-in `iot-device-focus` still adds shared device/app/cloud contract guidance because it matches the `smart-pillbox` pack name
