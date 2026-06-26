# PHP static-check defence — SSOT index

When the dhpk `php-7.4` module is enabled, this index orients you to the
style + static-analysis infrastructure. Each section links to the deeper
material in the sibling skill or hook script.

## Toolchain

| Tool | Default binary | Config file (auto-detected) | Stage |
|---|---|---|---|
| php-cs-fixer | `vendor/bin/php-cs-fixer` | `.php-cs-fixer.php` / `.php-cs-fixer.dist.php` | post-edit + pre-commit |
| PHPStan | `vendor/bin/phpstan` | `phpstan.neon` / `phpstan.neon.dist` / `phpstan.dist.neon` | pre-commit (when config present) |
| Psalm | `vendor/bin/psalm` | `psalm.xml` / `psalm.xml.dist` | pre-commit (when config present) |

**Adoption is optional per tier.** A project that ships only
`.php-cs-fixer.dist.php` gets the style gate; adding a `phpstan.neon` later
turns on the type gate without further dhpk configuration.

Override binary paths per project via:

- `CLAUDE_PLUGIN_OPTION_PHP_CS_FIXER_BIN` (default `vendor/bin/php-cs-fixer`)
- `CLAUDE_PLUGIN_OPTION_PHPSTAN_BIN` (default `vendor/bin/phpstan`)
- `CLAUDE_PLUGIN_OPTION_PSALM_BIN` (default `vendor/bin/psalm`)

Useful when the binary lives in a non-standard place (global install,
docker exec wrapper, monorepo with shared bin/).

## Edit-time and commit-time feedback

| Stage | Hook | Behaviour |
|---|---|---|
| Before `git commit` | `modules/php-7.4/hooks/pre-commit-php-validation.sh` (PreToolUse Bash) | Runs php-cs-fixer + (when configured) phpstan + psalm on staged `.php` files. Exit 2 rejects the commit. `[skip-php-lint]` in the commit message bypasses. |

Style is gated at commit time only — there is no per-edit php-cs-fixer hook (it would re-run what the commit gate already enforces). For an instant parse-error signal while editing, the `php-5.6` module ships `post-edit-php-syntax.sh` (`php -l`). The pre-commit hook skips `vendor/` and `*/vendor/*` paths regardless of project config.

## Skip / bypass conventions

| Need | How |
|---|---|
| Emergency hotfix, accept the lint debt now | Add `[skip-php-lint]` anywhere in the commit message |
| Project doesn't use php-cs-fixer at all | Don't ship a config file — the hook silent-skips |
| Project uses a non-standard binary path | Set `CLAUDE_PLUGIN_OPTION_PHP_CS_FIXER_BIN` |
| Lint shouldn't run on a specific subtree | Add the prefix to `php.skip_paths` in `modules/php-7.4/module.yaml` |

## Why this mirrors the JS module

The `js` module pioneered the "post-edit async lint + pre-commit
synchronous gate" two-tier pattern (see
`modules/js/references/static-checks.md`). The PHP module reuses the same
shape so users carry one mental model across stacks:

- **Post-edit hook** is a feedback signal — fast, async, never blocks.
- **Pre-commit hook** is a quality gate — synchronous, blocks on failure,
  has a documented bypass for emergencies.

The asymmetry between the two ("why doesn't the post-edit hook also block
on errors?") is intentional: blocking on every edit creates a tight,
frustrating feedback loop. The commit boundary is the right place to gate.

## Sibling material

| When… | Where to look |
|---|---|
| Designing a 7.4+ class, picking between a 7.4 and 8.x idiom, writing a polyfill, reviewing composer constraints | `modules/php-7.4/skills/php-modern-pro/SKILL.md` |
| Working on legacy 5.6 code (no overlap with this module's idioms) | `modules/php-5.6/skills/php-pro/SKILL.md` |
| `code-reviewer` or `security-reviewer` agent auditing a PHP diff | (project-level) — agents read the active modules' references when the matching sentinel fires |
