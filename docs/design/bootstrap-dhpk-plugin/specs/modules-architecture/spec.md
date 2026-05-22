## ADDED Requirements

### Requirement: Modules live under `modules/<name>/` with a documented layout

The plugin SHALL host each stack module under `modules/<name>/` where `<name>` is a kebab-case identifier of the shape `<stack>-<version>` (e.g. `php-5.6`, `yii-1.1`, `phpunit-5.7`). Each module directory SHALL contain:

- `module.yaml` (metadata; required)
- `skills/<skill-name>/SKILL.md` (zero or more)
- `references/<topic>.md` (zero or more; referenced from SKILL.md bodies)

No other top-level files inside `modules/<name>/` are loaded by the plugin in v0.1.0 (per-module hooks/agents/commands are explicitly out of scope).

#### Scenario: php-5.6 module is laid out correctly

- **WHEN** `ls modules/php-5.6/` is run on the plugin source
- **THEN** the directory contains `module.yaml`, `skills/php-pro/SKILL.md`, and at least one file under `references/`

#### Scenario: yii-1.1 module declares its dependency

- **WHEN** `cat modules/yii-1.1/module.yaml` is read
- **THEN** the `requires:` field lists `php-5.6` (and the SessionStart hook warns when yii-1.1 is enabled without php-5.6)

### Requirement: `module.yaml` follows a fixed flat schema

Each `module.yaml` SHALL provide these top-level keys with the documented types:

- `name` (string, kebab-case, matches the directory name)
- `display_name` (quoted string, human-readable)
- `version` (string, semver-style)
- `description` (quoted string, single-paragraph)
- `requires` (list of other module names; may be empty)
- `triggers` (object with `code`, `db`, `sec` sub-objects, each having `extensions:` and `paths:` lists)
- `provides` (object with optional `skills:` and `references:` lists for discovery only)

Hook scripts read `module.yaml` via a minimal in-script Python parser. Nested structures beyond this schema are NOT supported in v0.1.0.

#### Scenario: yaml parses successfully via the hook script's parser

- **WHEN** the post-edit-remind hook sources a module's `module.yaml`
- **THEN** the parser returns the `triggers.code.extensions`, `triggers.code.paths`, etc. as Python lists

#### Scenario: missing optional keys do not error

- **WHEN** a `module.yaml` omits `provides:` entirely
- **THEN** SessionStart and post-edit-remind both treat the module as valid

### Requirement: Plugin manifest declares each module's skills path explicitly

Because Claude Code cannot glob `./modules/*/skills/`, the plugin's `.claude-plugin/plugin.json` SHALL list each shipped module's skills directory explicitly in its `skills` array, alongside the default `./skills/`.

For v0.1.0:

```json
"skills": [
  "./skills/",
  "./modules/php-5.6/skills/",
  "./modules/yii-1.1/skills/",
  "./modules/phpunit-5.7/skills/"
]
```

#### Scenario: manifest validates with all three module paths

- **WHEN** `claude plugin validate /home/paul/projects/dhpk/plugins/dhpk --strict` is run
- **THEN** the command exits 0 and reports no warnings about missing skill directories

#### Scenario: adding a new module requires manifest update

- **WHEN** a developer creates `modules/python-3.11/skills/<x>/SKILL.md` WITHOUT adding the path to the manifest's `skills` array
- **THEN** the skill is NOT discovered by Claude Code (documented in README "Adding a new module")

### Requirement: `userConfig.modules` controls which modules activate

`plugin.json` SHALL declare a `userConfig.modules` entry of type `string` (multiple), default `[]`. At install time the user supplies a comma-separated list of module names. The list is exported to hook subprocesses as `CLAUDE_PLUGIN_OPTION_MODULES`.

#### Scenario: empty config disables all modules

- **WHEN** the plugin is installed without `--plugin-option modules=...`
- **THEN** SessionStart prints no module activation lines AND `DHPK_ACTIVE_MODULES` is unset for downstream hooks

#### Scenario: subset activation works

- **WHEN** installed with `--plugin-option modules=php-5.6`
- **THEN** SessionStart prints `[session-start] module enabled: php-5.6 — PHP 5.6 Language Baseline` AND `DHPK_ACTIVE_MODULES=php-5.6` is exported

### Requirement: SessionStart validates `requires` and emits activation lines

`session-start.sh` SHALL, for each module name in `CLAUDE_PLUGIN_OPTION_MODULES`:

1. Resolve `${CLAUDE_PLUGIN_ROOT}/modules/<name>/` — warn (stderr) and skip if missing
2. Parse `module.yaml` via the embedded Python parser
3. For each item in `requires:` not also in the enabled list, emit `[session-start] WARN: module '<name>' requires '<req>' but it is not enabled` to stderr
4. Emit `[session-start] module enabled: <name> — <display_name>` to stdout
5. Append the module name to `DHPK_ACTIVE_MODULES` (csv) and export it

The hook MUST NOT fail when `requires` validation fails — it only warns.

#### Scenario: missing requirement warns but does not block

- **WHEN** `modules=yii-1.1` (without `php-5.6`)
- **THEN** SessionStart exits 0 AND stderr contains `WARN: module 'yii-1.1' requires 'php-5.6' but it is not enabled`

#### Scenario: nonexistent module warns

- **WHEN** `modules=does-not-exist`
- **THEN** SessionStart exits 0 AND stderr contains `WARN: module 'does-not-exist' not found at`

### Requirement: post-edit-remind merges module triggers

`post-edit-remind.sh` SHALL read `DHPK_ACTIVE_MODULES` (csv) and for each active module load `modules/<name>/module.yaml`, extract `triggers.{code,db,sec}.{extensions,paths}`, and mark the corresponding reviewer slot when the edited file matches any extension or path-prefix.

User-supplied `review_trigger_extra_paths` (slot-prefixed entries) merge on top of module triggers.

#### Scenario: yii-1.1 trigger paths activate code-reviewer for protected/

- **WHEN** `modules=yii-1.1` AND an Edit modifies `protected/somefile.txt` (extension NOT in defaults)
- **THEN** `.pending-review` is written (matched via yii-1.1's `code.paths` entry `protected/`)

#### Scenario: module-triggered db-review fires on Repository edit

- **WHEN** `modules=yii-1.1` AND an Edit modifies `infrastructure/Repositories/UserRepo.php`
- **THEN** both `.pending-review` (via `.php` extension default) AND `.pending-db-review` (via yii-1.1's `db.paths`) are written

#### Scenario: user extra-paths add on top of module triggers

- **WHEN** `modules=yii-1.1` AND `review_trigger_extra_paths=sec:domain/` AND an Edit modifies `domain/Permission/Check.php`
- **THEN** `.pending-security-review` is written (user-supplied) AND `.pending-review` is written (PHP-extension default)

### Requirement: Three v0.1.0 modules ship with documented contents

The plugin SHALL ship exactly three modules in v0.1.0:

- `php-5.6` (PHP language baseline) — 1 skill (`php-pro`), 1 reference (`coding-style.md`). `requires: []`.
- `yii-1.1` (Yii framework) — 2 skills (`php56-yii-dev`, `yii1-security-audit`), 3 references (`framework.md`, `patterns.md`, `security.md`). `requires: [php-5.6]`. Triggers contribute `protected/`, `infrastructure/`, `domain/` paths.
- `phpunit-5.7` (PHPUnit test framework) — 2 skills (`phpunit-batch-refactor`, `legacy-code-characterization`), 1 reference (`testing.md`). `requires: [php-5.6]`. Triggers empty by default.

#### Scenario: All three modules pass `module.yaml` schema check

- **WHEN** each `module.yaml` is parsed by the SessionStart hook
- **THEN** all required fields are present and `triggers` / `provides` blocks have the expected shape

#### Scenario: External path references use placeholders

- **WHEN** `modules/yii-1.1/references/framework.md` is grepped for `~/projects/yii_framework/`
- **THEN** no match is found (replaced with `<YII_FRAMEWORK_PATH>` placeholder, documented in README)

### Requirement: New modules can be added without touching plugin core

The repo SHALL document (in README "Adding a new module") the exact steps to add a new module:

1. Create `modules/<name>/` with `skills/` and `references/` subdirs
2. Write `module.yaml` from the documented template
3. Add at least one `skills/<skill-name>/SKILL.md`
4. Append `"./modules/<name>/skills/"` to `plugin.json`'s `skills` array
5. Bump plugin version
6. Validate with `claude plugin validate --strict`
7. Document the module in `README.md`

No changes to core hooks, agents, or scripts SHALL be required to add a new module that only contributes triggers and skills.

#### Scenario: README contains the template

- **WHEN** the README "Adding a new module" section is read
- **THEN** it includes a complete `module.yaml` template and the 7-step procedure
