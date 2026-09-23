---
name: setup
description: "Short Claude front door for explicit-only $harness-setup host configuration and asset setup."
---
# `/dhpk:setup`

This is a thin Claude front door to the canonical `$harness-setup` Skill.
Forward `$ARGUMENTS` unchanged; the Skill owns host detection, configuration,
asset-installation, Review Gate setup, and terminal evidence.

Not for: ordinary harness audits, application changes, or silent credential/configuration changes.

The Skill selects the native procedure for the current Host. Claude keeps its
settings, `userConfig`, asset, and Review Gate behavior; Codex uses its
receipt-owned project installer and reports Claude-only options explicitly.
This command adds no mode, host flag, question flow, or second argument
grammar.

The installed Skill owns the Claude and Codex adapters. When an asset group is
selected, pass `--source-artifact <distribution-root>` as explicit task input;
the command forwards it unchanged and does not make the command an installer
implementation.

Completion: return the canonical Skill result with its `PASS`, `BLOCKED`,
`UNAVAILABLE`, `NOT_CONFIGURED`, or `NOT_RUN` state. The Skill's existing-user
file preservation and dry-run boundaries remain authoritative.
