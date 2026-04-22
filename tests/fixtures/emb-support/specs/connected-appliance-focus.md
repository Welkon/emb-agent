---
name: connected-appliance
title: Connected Appliance
summary: Connectivity state, safe defaults, OTA recovery, and local/remote consistency checks.
auto_inject: true
selectable: true
priority: 60
apply_when.specs: [connected-appliance]
focus_areas: [local_control, connectivity, config_sync, ota, fault_reporting]
extra_review_axes: [local_remote_consistency, reconnect_strategy, safe_defaults, upgrade_recovery]
preferred_notes: [docs/CONNECTIVITY.md, docs/RELEASE-NOTES.md, docs/DEBUG-NOTES.md]
---
# Connected Appliance

- Review connectivity state, OTA recovery, and local or remote consistency.
