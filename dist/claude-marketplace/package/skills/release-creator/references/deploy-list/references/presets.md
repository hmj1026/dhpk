# deploy-list Preset Catalog

Each preset defines four pieces of behavior:

1. **`PRESET_CATEGORIES`** — newline-delim `<sort-key>|<awk-ERE>` list. Patterns are
   matched in list order (first hit wins for the file's category), then output is sorted
   by sort-key (lexicographic — keep them monotonic).
2. **`PRESET_FILTER_EXTRA`** — ERE alternation appended to the universal filter base
   (defined in `scripts/deploy-list.sh:FILTER_BASE`). Files matching the composed filter
   are excluded from both main and warning groups.
3. **`PRESET_ROLLBACK_TRIGGER`** — awk regex tested against the main group; if any line
   matches, the `🔁 Rollback hints` section is emitted.
4. **`preset_print_{stats,filtered,rollback}_body`** — bash functions that print the
   per-section content. Variables they can use: `$MAIN_COUNT`, `$WARN_COUNT`, `$RAW_TOTAL`,
   `$FILTERED_OUT`, `$BASE`, `$HEAD_REF`, `$DEPLOY_SHAS[@]`, `$TF_MAIN`. Helper:
   `count_raw "$pattern"` (counts pre-filter diff lines matching pattern).

Universal filter base (applied to all presets) covers: AI agent docs anywhere
(`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`), `docs/`, `openspec/`, `README`, `SECURITY.md`,
`CHANGELOG.md`, `LICENSE`, AI harness dirs (`.claude/`, `.codex/`, `.gemini/`, `.agents/`),
`.github/`, `.gitignore`, IDE meta (`.idea/`, `.vscode/`).

---

## php-yii

Generic Yii 1.x project. Projects layering a custom DDD split on top
(domain/ + infrastructure/) or carrying a rollback-sensitive legacy
bundle should copy this preset and extend — see
`extended-presets.example/php-yii-acmeshop.sh` for a fully worked example
that adds DDD sort keys, a custom rollback trigger, a bilingual stats
body, and a curated filter list.

| Sort key | Match |
|----------|-------|
| 10 | `^protected/commands/` |
| 20 | `^protected/components/` |
| 30 | `^protected/controllers/` |
| 31 | `^protected/extensions/` |
| 32 | `^protected/models/` |
| 33 | `^protected/modules/` |
| 34 | `^protected/views/` |
| 40 | `^(css\|themes\|images\|media\|fonts\|assets)/` |
| 50 | `^js/[^/]+\.js$` |
| 51 | `^js/` (subdirs) |

**Extra filter**: `protected/tests/`, `tests/`, `phpunit*.xml`, `phpcs.xml`,
`.php-cs-fixer.*`, `composer.{json,lock}`, `ide_helper.php`, `.phpstorm.meta.php`.

**Rollback trigger**: none.

**Stats body**: English, `Deployed files: N (PHP: X, JS: Y, other: Z)`.

---

## laravel

Laravel application. App-by-layer sort reflecting Laravel's MVC + service convention.

| Sort key | Match |
|----------|-------|
| 10 | `^app/Domain/` |
| 20 | `^app/Infrastructure/` |
| 30 | `^app/Http/` |
| 31 | `^app/Models/` |
| 32 | `^app/Services/` |
| 33 | `^app/Console/` |
| 40 | `^database/(migrations\|seeders\|factories)/` |
| 50 | `^resources/views/` |
| 51 | `^resources/(css\|sass\|scss\|js\|ts)/` |
| 52 | `^public/` |
| 60 | `^routes/` |
| 70 | `^config/` |
| 80 | `^lang/` or `^resources/lang/` |

**Extra filter**: `bootstrap/cache/`, `storage/`, `tests/`, `phpunit*.xml`,
`.php-cs-fixer.*`, `.env.example`, `composer.{json,lock}`, `artisan`, `package*.json`,
`webpack.mix.js`, `vite.config.{js,ts}`, `ide_helper*`, `.phpstorm.meta.php`.

**Rollback trigger**: none.

**Stats body**: English, breakdown into `PHP / Blade / JS/TS / other`. Blade files
(`.blade.php`) are counted in their own bucket (note: they also match `.php$` so total
breakdown sum may exceed file count slightly — intentional for diagnostic clarity).

---

## node

Node.js / TypeScript projects, supports both monorepo (`packages/<pkg>/src`,
`apps/<app>/src`) and single-app (`src/`) layouts.

| Sort key | Match |
|----------|-------|
| 10 | `^packages/[^/]+/src/types/` |
| 11 | `^packages/[^/]+/src/core/` |
| 12 | `^packages/[^/]+/src/` |
| 13 | `^packages/[^/]+/lib/` |
| 20 | `^apps/[^/]+/src/` |
| 21 | `^apps/[^/]+/` |
| 30 | `^src/types/` |
| 31 | `^src/core/` |
| 32 | `^src/` |
| 40 | `^lib/` |
| 50 | `^public/` or `^static/` |
| 60 | `^server/` or `^api/` |

**Extra filter**: `dist/`, `build/`, `coverage/`, `node_modules/`, `.next/`, `.nuxt/`,
`.cache/`, `.turbo/`, `out/`, `tests?/`, `__tests__/`, `__mocks__/`,
`*.test.{js,ts,tsx,jsx}`, `*.spec.{js,ts,tsx,jsx}`, all `*.config.{js,ts,cjs,mjs}`
(jest, vitest, playwright), `package*.json`, `yarn.lock`, `pnpm-lock.yaml`,
`tsconfig*.json`, `.eslintrc.*`, `.prettierrc.*`.

**Rollback trigger**: none.

**Stats body**: English, breakdown into `TS / JS / CSS / other`.

---

## python

Python project, `src/<pkg>/` layout preferred but also handles `<pkg>/` at root.

| Sort key | Match |
|----------|-------|
| 10 | `^src/[^/]+/core/` |
| 11 | `^src/[^/]+/models/` |
| 12 | `^src/[^/]+/services/` |
| 13 | `^src/[^/]+/` |
| 20 | `^[^/]+/core/` |
| 21 | `^[^/]+/models/` |
| 22 | `^[^/]+/api/` |
| 30 | `^(migrations\|alembic)/` |
| 40 | `^templates/` |
| 50 | `^static/` or `^public/` |
| 60 | `^scripts/` |

**Extra filter**: `.venv/`, `venv/`, `env/`, `__pycache__/`, `*.pyc`, `*.pyo`,
`build/`, `dist/`, `.eggs/`, `*.egg-info/`, `htmlcov/`, `.coverage`, `.pytest_cache/`,
`.mypy_cache/`, `.ruff_cache/`, `.tox/`, `tests?/` (any depth), `test_*.py`,
`*_test.py`, `pytest.ini`, `setup.cfg`, `pyproject.toml`, `setup.py`,
`requirements*.txt`, `Pipfile*`, `poetry.lock`, `MANIFEST.in`.

**Rollback trigger**: none.

**Stats body**: English, breakdown into `Python / templates / other` (templates =
`.html`, `.jinja2`, `.j2`).

---

## generic

Language-agnostic fallback. Used by `auto-detect` when no ecosystem marker matches.
Conservative categorization — only obvious universal directories.

| Sort key | Match |
|----------|-------|
| 10 | `^src/` |
| 20 | `^lib/` |
| 30 | `^config/` |
| 40 | `^(assets\|public\|static)/` |
| 50 | `^scripts/` |

**Extra filter**: none. Universal filter base only.

**Rollback trigger**: none.

**Stats body**: English, just `Deployed files: N` (no language breakdown).

---

## Adding a custom preset

Create `presets/<your-name>.sh`. Required contract:

```bash
#!/usr/bin/env bash
PRESET_CATEGORIES='10|^your/pattern/
20|^another/pattern/'

PRESET_FILTER_EXTRA='^your/test/dir/|^build/artifact/'

PRESET_ROLLBACK_TRIGGER=''   # or a regex if rollback applies

preset_print_stats_body() {
    printf -- "- Deployed files: %d\n" "$MAIN_COUNT"
    # ... your custom breakdown using count_raw / awk on $TF_MAIN
    [[ "$WARN_COUNT" -gt 0 ]] && printf -- "- Out of scope: %d\n" "$WARN_COUNT"
    printf -- "- Diff range: %s...%s (raw %d, filtered %d)\n" \
        "$BASE" "$HEAD_REF" "$RAW_TOTAL" "$FILTERED_OUT"
    [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]] && printf -- "- Pinned commits: %d\n" "${#DEPLOY_SHAS[@]}"
}

preset_print_filtered_body() {
    # 4-5 lines categorizing what got filtered
    printf -- "- Tests: %d\n" "$(count_raw '^tests/')"
    # ...
}

preset_print_rollback_body() {
    :  # no-op, or your rollback message
}
```

Then activate by `--preset <your-name>` or by setting `DEFAULT_PRESET=<your-name>` in
`config.sh`. Add a fixture under `evals/generic/fixtures/` to keep your preset under
the regression net.

## Worked extended-preset example

`extended-presets.example/php-yii-acmeshop.sh` ships as a documented
example (NOT auto-loaded). It demonstrates non-trivial preset patterns
in one self-contained file:

- Multi-level sort keys spanning a DDD overlay (`domain/`,
  `infrastructure/`) on top of Yii's framework paths.
- A `PRESET_ROLLBACK_TRIGGER` that emits an operational fallback hint
  (the kind of thing a legacy monolith with a feature-flag-driven
  modular ↔ legacy toggle needs).
- A bilingual stats body (zh-TW + en) showing how to localise inside the
  preset without leaning on `i18n/` for body labels.
- A curated `PRESET_FILTER_EXTRA` listing the typical noise that
  accumulates in a long-running legacy app (custom build / debug
  artifacts, IDE helpers, characterization tests).

To use it: copy the file to `presets/<your-name>.sh`, rename `ACMESHOP_*`
identifiers, adjust paths to match your project's layout, then pin via
`config.sh`'s `DEFAULT_PRESET`.

## See also

- `references/why-this-grouping.md` — design rationale.
- `SKILL.md` § "When NOT to use" / "NEVER" — operational guardrails.
