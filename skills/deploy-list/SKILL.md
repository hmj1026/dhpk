---
name: deploy-list
description: 'Cross-project deploy file-list generator (schema=v1). Use when: building a deploy/release checklist from git history, listing which files to ship for a deploy, 部署清單, deploy list/checklist. Scope via --anchor (in-code markers), --deploy-commits (pinned commits), or whole base..head; filters dev-only paths (tests, docs, CI, AI harness) and groups by ecosystem preset (php-yii, laravel, node, python, generic, or a custom preset). Not for: plain commit lookup (git log), raw diffs (git diff), or actually running the deploy. Output: a deterministic deploy checklist (deploy-list.sh stdout, forwarded verbatim).'
triggers:
  - /deploy-list
  - deploy list
  - 部署清單
  - deploy checklist
---

# deploy-list

Generates a deploy file list from git history. **All logic lives in the
script** — Claude parses arguments, invokes the script, and emits stdout
verbatim. No post-processing.

## Package surfaces

The package keeps the immutable generator in `scripts/deploy-list.sh`, its golden
runner in `scripts/check-golden.sh`, ecosystem rules in `presets/`, structural labels
in `i18n/`, and preset guidance in `references/`. Copy `config.sh.example` to a
project-local `config.sh` when defaults need to be pinned. The `evals/` fixtures are
the regression surface for schema changes.

## Arguments

| Flag | Required | Default | Notes |
|------|----------|---------|-------|
| `--tag` | ✅ | — | `^\[.+\]$`, pure metadata, NOT used for grouping |
| `--description` | ✅ | — | freeform text |
| `--deploy-commits` | ⛳ | (none) | CSV of commit SHAs → union diff = main group; rest of base..head = warn group |
| `--anchor` | ⛳ | (none) | source-code inline anchor string → `rg -l --fixed-strings` finds matching source files; mutually exclusive with `--deploy-commits` / `--auto-detect-tag` |
| `--date` | ⛳ | today | `YYYY/MM/DD` |
| `--author` | ⛳ | `$DEFAULT_AUTHOR` → `$USER` → `user` | |
| `--project` | ⛳ | git toplevel basename | |
| `--base` | ⛳ | `$DEFAULT_BASE` → `main` | git ref (ignored in anchor mode) |
| `--head` | ⛳ | `HEAD` | git ref (ignored in anchor mode) |
| `--preset` | ⛳ | `$DEFAULT_PRESET` → auto-detect → `generic` | see Preset selection |
| `--lang` | ⛳ | `$DEFAULT_LANG` → `en` | `zh-TW` or `en` |
| `--auto-detect-tag` | ⛳ | off | grep -i -F `$TAG` in commit messages, fill --deploy-commits if empty |

Defaults marked `$DEFAULT_*` are read from `config.sh` if present. CLI
flags always win.

## Preset selection

Resolution order (first non-empty wins):

1. `--preset <name>` CLI flag
2. `$DEFAULT_PRESET` from `config.sh`
3. Auto-detect (probe order, first match wins):
   1. `protected/yii.php` or `protected/config/main.php` + `protected/views/` → `php-yii`
   2. `artisan` at root → `laravel`
   3. `package.json` + no `composer.json` → `node`
   4. `pyproject.toml` or `setup.py` → `python`
   5. fallback → `generic` (stderr note emitted)

Projects with DDD layering on top of Yii (or any other non-trivial
project-specific layering) should not rely on auto-detect — write a
custom preset (see `references/presets.md` and the worked example at
`references/extended-presets.example/php-yii-acmeshop.sh`) and pin it via
`config.sh`'s `DEFAULT_PRESET`.

**Note on stderr suppression**: the auto-detect fallback note goes to
stderr. `check-golden.sh` and the fixture scripts use `2>/dev/null` to
keep golden diffs clean, so the hint is invisible in CI. When manually
running deploy-list and unsure which preset was picked, omit `2>/dev/null`
or pass `--preset <name>` explicitly.

Full preset catalog → `references/presets.md`.

## Output

| # | Marker | Required | When |
|---|--------|----------|------|
| 1 | `# deploy-list schema=v1` | ✅ | line 1 |
| 2 | `⚠️  BASE 與 HEAD 相同…` line | ⛳ | only if base==head triggered auto-switch |
| 3 | Update time / Tag / Project (3 lines) | ✅ | always |
| 4 | Update files line + main group | ✅ | always (main group can be empty → "no deploy files" note) |
| 5 | `---` + `⚠️ Out of scope (…)` + warn group | ⛳ | only when --deploy-commits given and base..head has extras |
| 6 | `---` + `📊 Stats` header + preset-defined body | ✅ | always |
| 7 | `🚫 Filtered out (not deployed)` header + preset body | ✅ | always |
| 8 | `🔁 Rollback hints` header + preset body | ⛳ | only when preset rollback trigger matches main group |
| 9 | `# end deploy-list schema=v1` | ✅ | last line |

**Locked across presets / langs**: header marker, footer marker, section
ordering, the emoji prefixes (⚠️ 📊 🚫 🔁).

**Variable per preset/lang**: the human labels (e.g. `更新時間`/`Update
time`), the `📊 Stats` body lines (per-preset stat breakdown), the
`🚫 Filtered out` body lines (per-preset filter category labels), the
`🔁 Rollback hints` body. Stock presets emit nothing for rollback;
projects that need it (e.g. a legacy monolith with a feature flag for
fallback) wire it via a custom preset's `PRESET_ROLLBACK_TRIGGER`.

Changing the locked markers requires bumping schema=v1 → v2 + ADR +
golden refresh.

## Scope resolution modes

Three mutually-exclusive ways the script derives the deploy file list.
**Order of preference** (best to worst):

1. **Anchor mode** (`--anchor "<full anchor string>"`) — preferred for
   retrospective deploys where in-code anchor comments are the source of
   truth. Source files are found by `rg -l --fixed-strings "$ANCHOR"`
   against the working tree. Built-in excludes: `.claude/`, `.git/`,
   `node_modules/`, `protected/tests/coverage/html/`. Preset filter still
   applies. No git diff, no base/head needed.
2. **Pinned mode** (`--deploy-commits SHA1,SHA2,...`) — when feature
   commits are known. Union of those commits' diffs becomes the main
   group; remaining base..head diff goes to the `⚠️ Out of scope` warn
   group.
3. **Fallback mode** (no `--deploy-commits`, no `--anchor`) — whole
   base..head as one main group, no warn group. Easy to over-collect;
   only use when the entire range really is the feature scope.

The **anchor string** is a literal in-code marker convention. Two common
shapes:

```php
// 2026/02/09 paul [DemoTag]Description0205 start
// 2026/02/09 paul [DemoTag]Description0205 end
```

or PHPDoc:

```php
/**
 * 2026/02/09 paul [DemoTag]Description0205
 */
```

Pass the **full anchor string** (date + author + `[tag]` + description)
to `--anchor`. The script treats it as a literal `--fixed-strings`
pattern — no regex escaping needed.

## When NOT to Use

- Pure commit history lookup → `git log --oneline`.
- Diff outside base..head → plain `git diff`.
- Full commit message → `git log --grep`.
- Actually executing deploy → this skill only generates a checklist.

## NEVER

- **NEVER** use Write/Edit to hand-construct schema=v1 output. schema=v1
  is the script contract — the only allowed path is "invoke
  `deploy-list.sh`, forward stdout verbatim". If `rg` probe or the
  script fails (zero hits, timeout, encoding), stop and report; do not
  simulate the output (token cost ~5× and schema-contract drift risk).
- **NEVER** use `git log --grep="[tag]"` to derive deploy scope — tag
  is operational metadata, not stored in commit messages.
- **NEVER** post-process the script's stdout — schema=v1 is the contract,
  every byte matters.
- **NEVER** modify `--description` text (even if obviously typo'd) —
  that's input data.
- **NEVER** auto `git add/commit/push` — deploy-list is read-only.
- **NEVER** skip `--deploy-commits` to auto-group commits — that's an
  explicit "single main group, full base..head" mode (correct by design).
- **NEVER** translate the schema markers (`# deploy-list schema=v1`,
  section emoji prefixes) — they are byte-stable identifiers, not
  human-facing labels.
- **NEVER** add project-specific paths to a generic preset — project
  rules belong in a named preset (e.g. `presets/<your-project>.sh`) or
  in `config.sh`.

## Adopting this skill in a project

The skill is designed as a copy-paste template. To use in another repo:

1. Copy the whole `skills/deploy-list/` directory + the matching
   `/deploy-list` slash command into the project's `.claude/`.
2. Copy `config.sh.example` to `config.sh` and edit:
   - `DEFAULT_PRESET=` pick the matching preset (`php-yii`, `laravel`,
     `node`, `python`, `generic`) or leave empty for auto-detect.
   - `DEFAULT_BASE=` your integration branch (often `main` or `develop`).
   - `DEFAULT_LANG=` `zh-TW` or `en`.
   - `DEFAULT_AUTHOR=` optional team-wide author pin.
3. Optional: add a custom preset at `presets/<your-name>.sh` following
   the worked example at `references/extended-presets.example/`.
4. Smoke test: `bash scripts/check-golden.sh` — all generic fixtures
   should pass.

## Verification

```bash
# Run the bundled fixture suite
bash skills/deploy-list/scripts/check-golden.sh

# Update goldens after an intentional schema change
bash skills/deploy-list/scripts/check-golden.sh --update
```

Manual checks after running deploy-list:

- [ ] Line 1 = `# deploy-list schema=v1`.
- [ ] Last line = `# end deploy-list schema=v1`.
- [ ] Main group ≥ 1 file (else "no deploy files" note present).
- [ ] Stats filter counts ≈ git diff total (rename rows may differ by ±2).
- [ ] Rollback hint present iff the preset's `PRESET_ROLLBACK_TRIGGER`
      actually matched a file in the main group.

## Platform compatibility

Tested on Linux (bash 4+), macOS (bash 3.2 default), WSL2. Requires POSIX
`git awk sort comm grep sed wc tr mktemp basename printf` in PATH. Fails
fast on bash < 3.0 or missing tools.

Key BSD/GNU compat fixes:

- `git -c core.quotepath=false` (macOS git path quoting).
- `sort -t"$TAB"` (BSD sort doesn't accept `$'\t'` in some contexts).
- `LC_ALL=C` throughout (deterministic byte ordering across locales).
- `mktemp` portable form (`mktemp || mktemp -t prefix`).

## Why these decisions

Detailed history → `references/why-this-grouping.md`.
Preset catalog + custom-preset guide → `references/presets.md`.

Headlines:

- **`--deploy-commits` (not `--tag`-driven)**: tag is ops metadata
  (store-code, version, batch); commit is dev artifact. Coupling them
  via `git log --grep` becomes a dead path in practice — fallback rate
  approaches 100%.
- **Per-preset category sort**: deploy order should reflect dependency
  direction (domain → infra → presentation → assets → entry bundle) so
  partial deploys don't break loading.
- **Per-ecosystem filter sets**: `protected/tests/` only makes sense in
  Yii; `dist/` only in Node; `__pycache__/` only in Python. A universal
  filter would either over- or under-filter.
- **i18n only for structural headers**: per-preset stat bodies vary in
  vocabulary (PHP/JS vs TS/JS/CSS vs Python/templates), so they're
  owned by presets, not i18n.
