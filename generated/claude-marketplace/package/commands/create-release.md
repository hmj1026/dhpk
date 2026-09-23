---
description: 'Cut a new release of a project or plugin — resolve release config, bump version(s), update CHANGELOG, create release PR, and tag'
argument-hint: '<version> [--execute]'
allowed-tools: 'Bash(git:*), Bash(gh:*), Bash(jq:*), Bash(test:*), Read, Grep, Glob'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

Forward `$ARGUMENTS` unchanged to the explicit-only, external-write
`$release-creator` Skill.
It owns release configuration, version/changelog edits, validation, the human
merge gate, tag/CI sequence, and publication evidence.

Preserve `<version> [--execute]`. Relay the owner’s blocked, prepared, merged,
tagged, or CI result; never claim a release, tag, or publication from local
edits or an unassociated workflow.
