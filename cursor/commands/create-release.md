---
name: create-release
description: "Cut a new release of a project or plugin — resolve release config, bump version(s), update CHANGELOG, create release PR, and tag"
---
Forward `$ARGUMENTS` unchanged to the explicit-only, external-write
`$release-creator` Skill.
It owns release configuration, version/changelog edits, validation, the human
merge gate, tag/CI sequence, and publication evidence.

Not for: PHP package publication or ordinary commits.

Preserve `<version> [--execute]`. Relay the owner’s blocked, prepared, merged,
tagged, or CI result; never claim a release, tag, or publication from local
edits or an unassociated workflow.
