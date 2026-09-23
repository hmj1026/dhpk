---
name: matrix-cell-onboard
description: "Add a new PHP/Laravel/PHPUnit/Monolog cell to a multi-major library's CI matrix. Walks composer constraints, workflow YAML, Testbench mapping, polyfill branch coverage, dual-testsuite gating, and a local dry-run. Use when extending support to a new runtime version, restoring a previously dropped cell, or onboarding a new dep major (Monolog 4, Flysystem 4, PHPUnit 12)."
---
Forward `$ARGUMENTS` unchanged to the workspace-write canonical
`$matrix-cell-onboard` Skill.
It owns Composer/workflow bounds, Laravel-to-Testbench mapping, polyfill branch
coverage, dual-testsuite gating, and the local dry-run.

Not for: patch-only changes that do not alter the support matrix.

Preserve the `<php> <laravel> [phpunit] [monolog]` grammar and the owner’s
single onboarding report, open questions, and apply-or-defer confirmation. This
front door adds no second matrix procedure or authority.
