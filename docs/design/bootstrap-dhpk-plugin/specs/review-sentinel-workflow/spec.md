## ADDED Requirements

### Requirement: hooks.json wires PreToolUse, PostToolUse, SessionStart, and Stop hooks

The original bootstrap used direct script entries. The maintained plugin SHALL
provide `hooks/hooks.json` declaring the current wrapper-dispatch chain:

- `PreToolUse` matchers: `Edit|Write|MultiEdit` → `pre-edit-guard.sh`; `Bash` → the pre-bash dispatcher/gates
- `PostToolUse` matchers: `Edit|Write|MultiEdit` → `post-edit-dispatch.sh`, which runs `post-edit-remind.sh` synchronously before module hooks; independent async advisories remain separately wired
- `SessionStart` → `session-start.sh`
- `Stop` → the review reminder and stop-advisory-dispatch chain

Each hook SHALL use structured command wiring: `command: "bash"` with
`args: ["${CLAUDE_PLUGIN_ROOT}/scripts/hooks/<name>.sh"]`, so plugin-root paths
containing spaces remain one argument.

#### Scenario: Hooks register on enable

- **WHEN** the plugin is enabled
- **THEN** `claude --debug` output shows each declared hook registering against its event/matcher pair

#### Scenario: Edit fires PostToolUse chain

- **WHEN** an Edit tool call modifies a `.php` file in a project with the plugin enabled
- **THEN** `post-edit-dispatch.sh` runs `post-edit-remind.sh` synchronously before any background module hook, while separately wired async advisories may run independently

### Requirement: post-edit-remind.sh writes sentinels based on file-extension triggers

`post-edit-remind.sh` SHALL inspect the edited file path and write applicable
sentinel files under `.claude/artifacts/sessions/` when it matches a reviewer's
trigger pattern. The maintained slot set is:

- **code-reviewer** (slot 0, `.pending-review`): common source extensions and harness code/config artifacts
- **database-reviewer** (slot 1, `.pending-db-review`): SQL and migration source
- **security-reviewer** (slot 2, `.pending-security-review`): auth/login/ACL/upload/file source paths
- **frontend-reviewer** (slot 3, `.pending-frontend-review`): module or `fe:` opt-in triggers
- **doc-reviewer** (slot 4, `.pending-doc-review`): maintained harness, OpenSpec, `docs/`, and repository-level instruction Markdown
- **polyfill-reviewer** (slot 5, `.pending-polyfill-review`): `library-author` module triggers
- **migration-reviewer** (slot 6, `.pending-migration-review`): module or `mig:` opt-in triggers

The script SHALL also merge triggers from each active module (see
`modules-architecture` spec), including the maintained aliases for frontend,
documentation, polyfill, and migration slots.

The script SHALL append path-prefix triggers from
`CLAUDE_PLUGIN_OPTION_REVIEW_TRIGGER_EXTRA_PATHS` using `code`, `db`, `sec`,
`fe`, `doc`, or `mig` prefixes.

Order of trigger evaluation (any match writes the sentinel): file-extension defaults → active-module triggers → user extra-paths.

Sentinel appends SHALL be idempotent per path. The hook SHALL persist the armed
sentinel-set signature in `.advisory-state` and print the mandatory pending-review
advisory only when that set changes. A no-trigger skip SHALL be silent unless
`DHPK_DEBUG=1`.

#### Scenario: Edit to a PHP file writes code-review sentinel

- **WHEN** an Edit modifies `app/Service/Foo.php`
- **THEN** `.claude/artifacts/sessions/.pending-review` exists and contains a line with the timestamp and file path

#### Scenario: Edit to a SQL file writes db-review sentinel

- **WHEN** an Edit modifies `migrations/2026_05_21.sql`
- **THEN** `.claude/artifacts/sessions/.pending-db-review` exists

#### Scenario: Extra-paths override extends the code-reviewer trigger

- **WHEN** the project has `userConfig.review_trigger_extra_paths=["code:protected/"]` AND an Edit modifies `protected/somefile.txt`
- **THEN** `.pending-review` is written even though `.txt` is not in the default code-reviewer extension set

#### Scenario: Self-edits to plugin artifacts do not trigger reviews

- **WHEN** an Edit modifies a file under `.claude/artifacts/`
- **THEN** no sentinel is written (avoids self-trigger loop when review agents write their own reports)

### Requirement: clear-sentinel.sh removes a sentinel by exact name or prefix-less form

`scripts/hooks/clear-sentinel.sh <sentinel-name> [agent-label]` SHALL delete the named sentinel file if present, support `--all` to clear every known sentinel, normalise a prefix-less form (the sentinel basename minus its `.pending-` prefix; NOT the same as the `SENTINEL_SHORT_NAMES` used elsewhere, e.g. `sec`, `db`, `doc` — those are not accepted here) to its canonical `.pending-` form when that form is a known sentinel, and fail fast (exit 2) with a helpful message when given an unknown sentinel name.

#### Scenario: Prefix-less form is normalised to the canonical name

- **WHEN** `clear-sentinel.sh review code-reviewer` is run while `.pending-review` exists
- **THEN** the name is normalised to `.pending-review`, the file is removed, and every downstream consumer (stdout message, learning-db signature, review-backoff reset) receives the canonical name

#### Scenario: Valid clear succeeds

- **WHEN** `clear-sentinel.sh .pending-review code-reviewer` is run while `.pending-review` exists
- **THEN** the file is removed and the script prints `[code-reviewer] sentinel cleared (.pending-review)`

#### Scenario: Unknown sentinel name is rejected even after normalisation

- **WHEN** `clear-sentinel.sh bogus code-reviewer` is run (neither a known sentinel nor a prefix-less form of one)
- **THEN** the script exits 2 and prints the list of known sentinel names

### Requirement: stop-review-reminder.sh blocks Stop when pending sentinels exist

`stop-review-reminder.sh` SHALL scan all seven sentinel files and, if any exist,
write a reminder to stderr listing each pending sentinel, the configured agent
responsible, sample triggering files, and the manual-clear command — then exit 2
(Claude Code's "block stop, feed stderr to next turn" semantic).

When `CLAUDE_PLUGIN_OPTION_HOOK_PROFILE=minimal`, the script SHALL suppress reminders and exit 0.

#### Scenario: Pending sentinel blocks stop

- **WHEN** the Stop event fires while `.pending-review` exists
- **THEN** the script exits 2 AND stderr contains the line `PENDING: code-reviewer (N file(s) awaiting review)` (using the configured agent name) AND lists the manual clear command

#### Scenario: Minimal profile suppresses reminder

- **WHEN** `hook_profile=minimal` AND Stop fires with `.pending-review` present
- **THEN** the script exits 0 with no stderr output

### Requirement: session-start.sh checks configured docker containers

`session-start.sh` SHALL create `.claude/artifacts/{reviews,plans,audits,refactors,codemaps,adr,sessions}/` directories, write `sessions/latest.md` with git branch/staged/modified counts, and (only if `CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS` is non-empty) check each named container's running status. Output line on stdout: `[session-start] branch=<b> docker=<status> profile=<p>`.

When `hook_profile=strict` AND any configured container is not running, the script SHALL append a `[WARN]` line per missing container to stdout.

Additionally, `session-start.sh` SHALL parse `CLAUDE_PLUGIN_OPTION_MODULES`, validate each module's `requires:` field, emit one activation line per active module, and export `DHPK_ACTIVE_MODULES` for downstream hooks (see `modules-architecture` spec for full module-load semantics).

#### Scenario: Empty docker config skips docker check

- **WHEN** SessionStart fires with `docker_containers=[]`
- **THEN** the script does not invoke `docker` AND the status line omits the docker section

#### Scenario: Strict profile warns on missing container

- **WHEN** `docker_containers=["pos_php","pos_mysql"]`, `hook_profile=strict`, AND `pos_php` is not running
- **THEN** the script stdout includes `[WARN] pos_php not running`

### Requirement: pre-edit-guard.sh and pre-bash-guard.sh block dangerous operations

`pre-edit-guard.sh` SHALL block Edit/Write/MultiEdit attempts targeting `.env`, `.env.*`, or anything under `.git/` (exit 2 with a stderr message). `pre-bash-guard.sh` SHALL block bash commands containing destructive patterns (`rm -rf /`, `git push --force` against `main|master`, etc.) using the same exit-2 semantic.

#### Scenario: Edit to .env is blocked

- **WHEN** an Edit attempts to modify `.env`
- **THEN** the hook exits 2 and prints a stderr message naming the protected path

### Requirement: post-edit-advisory.sh normalises shell-script line endings

`post-edit-advisory.sh` SHALL run asynchronously after Edit/Write/MultiEdit calls
and, when the edited file is a `.sh` file containing CRLF line endings, rewrite
it in place with LF endings. This merged advisory hook also owns root-manifest
lockfile reminders; it is independent of synchronous sentinel routing.

#### Scenario: CRLF in .sh file gets fixed

- **WHEN** a Write tool call creates `foo.sh` containing CRLF line endings (common on WSL)
- **THEN** after the async hook completes, `foo.sh` contains LF endings only

### Requirement: _lib/payload.sh exposes sentinel arrays driven by userConfig

`scripts/hooks/_lib/payload.sh` SHALL:

- Define the seven fixed sentinel names in slot order: review, database,
  security, frontend, documentation, polyfill, migration
- Define `SENTINEL_AGENTS=(...)` initialised from
  `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS` (comma-split), padding a short override
  from the seven shipped defaults
- Define seven fixed short labels in the same slot order
- Expose `extract_tool_input <field> "<payload>"` helper using `jq` with `python3` fallback (no hard dependency on either alone)

The file SHALL be source-only and SHALL NOT execute side effects when sourced.

#### Scenario: Default agents used when env unset

- **WHEN** `payload.sh` is sourced with `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS` unset
- **THEN** `${SENTINEL_AGENTS[*]}` equals the seven shipped reviewer names in
  code/database/security/frontend/documentation/polyfill/migration slot order

#### Scenario: Override via env propagates

- **WHEN** `payload.sh` is sourced with `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS=a,b,c`
- **THEN** `${SENTINEL_AGENTS[*]}` equals
  `a b c frontend-reviewer doc-reviewer polyfill-reviewer migration-reviewer`
