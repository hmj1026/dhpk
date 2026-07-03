---
description: 'Add a new PHP/Laravel/PHPUnit/Monolog cell to a multi-major library''s CI matrix. Walks composer constraints, workflow YAML, Testbench mapping, polyfill branch coverage, dual-testsuite gating, and a local dry-run. Use when extending support to a new runtime version, restoring a previously dropped cell, or onboarding a new dep major (Monolog 4, Flysystem 4, PHPUnit 12).'
argument-hint: '"<php-version> <laravel-version> [phpunit] [monolog]"  e.g. "8.3 12 11 3"'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, AskUserQuestion'
---

⚠️ **Must read and follow the skill below before executing this command:**

@modules/library-author/skills/matrix-cell-onboard/SKILL.md

## Context

- composer.json: !`grep -E '"(php|laravel/framework|monolog/monolog|orchestra/testbench|phpunit/phpunit)"' composer.json 2>/dev/null | head -10`
- workflow files: !`ls .github/workflows/ 2>/dev/null`
- Active dhpk modules: !`grep -A 20 '"modules"' .claude/settings.local.json 2>/dev/null | head -25`

## Arguments

| Parameter | Description |
|-----------|-------------|
| `<php>` | Target PHP version (e.g. `8.3`) |
| `<laravel>` | Target Laravel major (e.g. `12`) |
| `[phpunit]` | Optional explicit PHPUnit major; defaults to Laravel-compatible minimum |
| `[monolog]` | Optional explicit Monolog major; defaults to Laravel-compatible minimum |

If only `<php> <laravel>` are supplied, the skill derives the remaining
versions from the Laravel ↔ Testbench ↔ PHPUnit mapping table.

## Prerequisites

| Prerequisite | Check |
|--------------|-------|
| `library-author` module enabled | `pluginConfigs.dhpk@dhpk.options.modules` in `.claude/settings.local.json` |
| `composer.json` uses `\|\|` across majors | `grep '\|\|' composer.json` returns hits in `require` |
| `.github/workflows/` has a matrix definition | `ls .github/workflows/` shows `tests.yml` or similar |

If `library-author` is not enabled, the skill still runs but cannot
auto-trigger the `polyfill-reviewer` sentinel on the resulting edits.
Enable it first via `/dhpk:setup` or by editing
`.claude/settings.local.json`.

## Execution

Follow the SKILL.md procedure step-by-step. Do not skip step 4 (polyfill
branch coverage) — it is the most common source of silent matrix-add
regressions in multi-major libraries.

Output a single onboarding report matching the SKILL.md `## Output`
template, then ask the user whether to apply the composer.json /
workflow YAML edits in this same session or defer to a follow-up.
