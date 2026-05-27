# Changelog

## 0.4.0 — 2026-05-27 — Absorb zdpos harness improvements + introduce rules/ resource layer

Feature release. Pulls in improvements from the zdpos_dev project after a
133-pair Phase A diff (15 agents + 65 commands + 53 skills) revealed:
(1) dhpk's existing role agents and codex commands already dominate the
overlap — most zdpos copies were stale forks of older dhpk releases plus
hardcoded project name / container path; (2) a small set of skills /
commands / agents exist only in zdpos that are framework-generic enough to
de-identify and ship upstream; (3) zdpos has been maintaining three
governance rules (execution-policy, tool-routing, anti-rationalization) as
plain markdown — dhpk did not have a `rules/` layer at all.

### Added

- **`agents/migration-reviewer.md`** — multi-tenant DB migration safety
  reviewer (up/down symmetry, idempotency, FK / index naming collision
  across multi-tenant deploy footprints, large-ALTER strategy on
  high-volume tables). Companion to (not replacement for)
  `database-reviewer`. Originally a zdpos-specific reviewer for Yii 1.1
  migrations; de-identified to drop the "22 merchant" wording and the
  hardcoded `pos_mysql` / `pos_php` container names. Registered in
  `plugin.json` `agents[]`. Triggered by a project that wires
  `.pending-migration-review` sentinel in its post-edit hook (zdpos
  ships this; other projects can adopt the same sentinel name).
- **`commands/de-ai-flavor.md`** — command shell that invokes the
  existing `de-ai-flavor` skill. Skill itself already shipped in
  v0.3.x; only the slash command was missing.
- **`commands/deploy-list.md`** — command shell for the existing
  `deploy-list` skill. Adds the `/deploy-list` slash command surface
  to dhpk; skill body already supports the generic preset matrix
  (php-yii-zdpos / php-yii / laravel / node / python / generic).
- **`commands/goal-ex.md`** + **`skills/goal-ex/`** — extended `/goal`
  meta-workflow that runs ≤3 parallel Explore subagents to inventory a
  project and propose `.claude/{skills,agents,rules}` + per-layer
  CLAUDE.md additions. Skill plus command; first true zdpos-only
  contribution that dhpk did not previously stub.
- **`commands/ui-ux-verify.md`** — command shell that delegates to the
  existing `ui-ux-verifier` agent (no `-zdpos_dev` suffix; URL regex
  parameterised as `<app-host>` instead of the original `posdev.test`).
  Default mode lists currently-changed OpenSpec specs and prompts for
  one to verify; URL mode bypasses the spec lookup. Requires the
  external OpenSpec plugin for the Default Mode flow (URL Mode works
  standalone).
- **`modules/yii-1.1/commands/yii1-security-audit.md`** — per-module
  command (loaded only when `yii-1.1` is in `userConfig.modules`).
  Slash command for the existing `yii1-security-audit` skill in the
  same module; routes through the 8-item audit checklist
  (AUTH / CSRF / XSS / SQL / CFG / LOGIC / FILE) and emits a
  type-coded report. Module manifest updated:
  `provides.commands: [yii1-security-audit]`.
- **`rules/`** — new resource layer. Three plain-markdown files,
  cross-referenced by existing skills (`dhpk-execution-policy`,
  `tool-routing`) and consumable from downstream `CLAUDE.md` via the
  `${CLAUDE_PLUGIN_ROOT}/rules/<file>.md` path. **Not** registered in
  `plugin.json` — the Claude Code plugin manifest schema has no
  `rules` key, by design. Downstream projects opt in by referencing
  them; nothing auto-loads.
  - `rules/execution-policy.md` — task-mode taxonomy
    (small change / small bug / medium change / unknown-cause bug /
    new feature / architecture change), sentinel chain rule when
    multiple `.pending-*` files coexist, AI-judgment back-stop for
    triggers that hooks cannot match by path alone.
  - `rules/tool-routing.md` — decision tree for code-search tools
    (cx / gitnexus / claude-mem / Read / Grep), tie-breakers, sub-agent
    prompt boilerplate guidance.
  - `rules/anti-rationalization.md` — 5 common self-justification
    patterns when about to skip a reviewer / TDD / sentinel step, plus
    counter-arguments. On-demand load (not always-on).

### Refactored

- **`modules/yii-1.1/references/patterns.md`** — appended a "Refactor
  cleanup checklist (Yii 1.1)" section absorbing six Yii-1.1-specific
  trap knowledge items from zdpos's local `refactor-cleaner` agent
  prose (stale `relations()`, disabled `before/afterSave` hooks,
  obsolete module aliases in `protected/config/main.php`, base-
  controller-registered Behaviors that descendants override, orphan
  view partials with dead `CHtml::scriptFile()` calls, and the
  Yii-alias-autoload reason rename MUST go through `gitnexus_rename`).
  Original zdpos agent body had these mixed into the role description;
  dhpk splits them into the framework module's reference notes so the
  language-agnostic `refactor-cleaner` agent itself stays small. The
  agent body already cross-links to the module overlays, so no agent
  edit is needed.
- **`skills/execution-checklist/SKILL.md`** — absorbed three cross-
  cutting patterns from zdpos's local skill: (a) a fourth Per-reply
  mandatory box, **Edit-before-Read enforced**, with the matching
  error message keywords listed; (b) a new sub-section, **Mass refactor
  preference order** (`sed` / formatter > `Edit replace_all` > N-deep
  multi-file Edit) — historically the highest-leverage anti-pattern
  in cross-file mechanical replacements; (c) two new Conditional table
  rows — bare `glob` expansion in shells without `nullglob` (a sentinel-
  check trap in zsh / dash / BusyBox), and the `clear-sentinel.sh` path
  SSOT (`${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh`, NOT
  `${CLAUDE_PROJECT_DIR}/.claude/scripts/...`). Specific high-volume
  table names (e.g. `records`, `orders`, `stock`) deliberately kept
  out — those belong in each consuming project's own rules, not in
  dhpk's generic skill.

### Verified

- `plugin.json` validates against the Claude Code v2.1.150 plugin
  manifest schema after the agents[] addition and per-module command
  registration via `module.yaml.provides.commands`.
- `modules/yii-1.1/module.yaml` matches the existing `modules/js/`
  shape (which already ships a per-module command,
  `ts-check-status`).
- New `rules/` layer is purely additive — no existing skill / agent
  body relies on it for hard dependency; cross-refs are advisory.

### Deferred

- **`commands/create-dev.md` not ported** — zdpos's `/create-dev` is
  the routing command that triggers `adaptive-dev-workflow` skill
  before implementation. The skill carries deep references to
  zdpos-suffixed agents (`tdd-guide-zdpos_dev`, `architect-zdpos_dev`,
  etc.) and a project-specific `references/projects-zdpos.md` knowledge
  file, plus four `.py` orchestration scripts. Porting requires a
  proper skill de-identification pass — not a fast win for v0.4.0.
  Tracked for a future release.

### Non-changes

- Hook architecture untouched. dhpk's 5-slot `userConfig.review_agents`
  remains unchanged this release. Adding a 6th slot to formally
  support migration-style reviewers is tracked for v0.5.x.
- No existing skill / agent / command body was renamed or removed.
- No userConfig defaults changed.

## 0.3.2 — 2026-05-26 — Validate release workflow stdin pipe

Purely a CI-infrastructure release. v0.3.1 tag-push failed at the GitHub
Release step because the workflow inlined CHANGELOG body directly into a
gh release create --notes argument; the runner shell then tried to expand
backticks and dollar-paren in the body as command substitutions, emitting
a flood of command-not-found errors. The release page for v0.3.1 was
manually patched in afterwards. The workflow fix was committed to main as
4689a3f but has not yet been exercised by an actual tag push. This
release exists solely to drive that exercise on a real CI run.

### Fixed

- .github/workflows/release.yml now passes the extracted notes through
  an env: variable and streams them via printf piped into
  gh release create --notes-file -, so CHANGELOG bodies that contain
  backticks or dollar-paren can no longer be interpreted by the runner
  shell. Future releases whose CHANGELOG entry uses code spans are now
  safe to tag-push without manual recovery.

### Verified

- If you can read this release body on the GitHub Releases page with
  the markdown intact, the fix landed: this body itself is deliberately
  written WITHOUT backticks or dollar-paren so that a defective workflow
  would still succeed to publish the page, while the v0.3.1 body further
  down in CHANGELOG.md (which is full of code spans) exercises the
  awk-extract step on shell-hostile content during local pre-verify.

### Non-changes

- No agent, skill, command, module, hook, or manifest change beyond the
  version bump in .claude-plugin/plugin.json and the pinned-version
  example in README.md. Users on v0.3.1 have no functional reason to
  upgrade; this is a release-pipeline confidence checkpoint.

## 0.3.1 — 2026-05-26 — Fix plugin.json agents schema regression + SKILL.md frontmatter

v0.3.0 shipped two latent manifest bugs that turned out to be installation
blockers in the wild. A consumer (`hmj1026/devkit`) tried to install the
new `library-author` module and got back:

```
Plugin dhpk has an invalid manifest file at
~/.claude/plugins/cache/dhpk/dhpk/8cb34b318356/.claude-plugin/plugin.json.
Validation errors: agents: Invalid input
```

The cache had **already fetched** the v0.3.0 commit successfully — the
manifest validator rejected it post-fetch, so no part of the plugin
loaded. The promised library-author module wasn't merely missing; the
entire dhpk plugin was unreachable.

### Fixed

- **`.claude-plugin/plugin.json` — `agents` field schema**: v0.3.0 used
  directory paths (`["./agents/", "./modules/library-author/agents/"]`),
  but the Claude Code v2.1.150 plugin manifest schema requires individual
  `.md` file paths (per
  [plugins-reference](https://code.claude.com/docs/en/plugins-reference.md),
  line 384 / 567). Switched to enumerating each agent `.md`:
  15 root agents + 1 module agent (`polyfill-reviewer.md`).
  `commands` schema was looser and tolerated `["./commands/"]`, so it
  stays unchanged this release — only the failing field was touched.
- **`skills/polyfill-version-matrix-audit/SKILL.md` frontmatter**: the
  `description` value contained `Symptoms that trigger this skill:` —
  a mid-line `:` + space + text, which YAML parses as a mapping value
  inside the already-implicit description mapping. Result: YAML parser
  emitted `Unexpected token` and Claude Code **silently loaded the skill
  with empty metadata** (no `name`, no `description`, no matchers). The
  skill was effectively inert for matching. Rewrote `description` as a
  folded block scalar (`>-`) and replaced the inner `:` with ` — ` to
  remove the parse ambiguity. Wording preserved so claude-mem corpora and
  skill matchers still hit the same keywords.
- **`.claude-plugin/marketplace.json` description**: still listed
  `(php-5.6, yii-1.1, phpunit-5.7)` — three of the seventeen modules
  dhpk ships today. Synced to the v0.3.x surface (PHP 5.6/7.4/8.x,
  Yii 1.1, PHPUnit 5.7/9/10/11, Laravel 6–11, JS, library-author) and
  added the 6-slot reviewer note.
- **`.claude-plugin/plugin.json` `description`**: same drift — updated.
- **`README.md`** — synced the top-line summary, agents/modules count
  table, `userConfig.modules` ships list, Modules section bodies, and
  repository-layout tree to actually describe what v0.3.x contains.
  Bumped the pinned-version example from `v0.2.1` to `v0.3.1`. Added a
  modern-Laravel-library install example alongside the legacy PHP/Yii
  example.

### Verified

- `claude plugin validate /home/paul/projects/dhpk/.claude-plugin/plugin.json`
  → `✔ Validation passed` (no `agents: Invalid input`, no SKILL frontmatter
  error in the bundled skill scan).
- `claude plugin validate /home/paul/projects/dhpk/` (full plugin +
  marketplace) → both pass.
- Downstream cache invalidation round-trip on `hmj1026/devkit`:
  - `rm -rf ~/.claude/plugins/cache/dhpk/`
  - new Claude Code session
  - no "Invalid manifest" error
  - `~/.claude/plugins/cache/dhpk/dhpk/0.3.1/` materialises
  - `/agents` lists `dhpk:polyfill-reviewer`
  - editing a `.php` file containing `version_compare` writes
    `.pending-polyfill-review` and the next prompt fires the reviewer.

### Upgrade notes

- Anyone who tried to install v0.3.0 and saw the "invalid manifest"
  error: clear `~/.claude/plugins/cache/dhpk/` once, then reinstall;
  v0.3.1 onwards is the first **actually-installable** release in the
  0.3.x line.
- v0.3.0 git tag and GitHub Release remain in place (no force-push) to
  avoid breaking downstream caches that did manage to extract it before
  validation. They should be treated as superseded by 0.3.1.

## 0.3.0 — 2026-05-25 — Ship library-author module (sixth-color polyfill reviewer)

Three previous commits landed the `library-author` module on `main` —
agent body, module skills, sentinel hook, references — but `plugin.json`
was never updated to register the new surface. Result: a sibling project
(`hmj1026/devkit`, multi-major PHP polyfill library) explicitly enabled
`library-author` in its `.claude/settings.local.json`, expected the
sixth-color reviewer to fire on guard edits, and got nothing. Symptom
was silent: `reload-plugins` reported the same skill/agent counts as
0.2.4 because Claude Code never saw the module declarations. This
release is the manifest catch-up plus a slash-command alias for the
matrix-cell onboarding skill.

### Added

- `modules/library-author/` — first shipped via `plugin.json` declarations.
  - `agents/polyfill-reviewer.md` — sentinel-driven reviewer fired by
    `.pending-polyfill-review`; sixth color filling the gap left by
    code/db/sec/frontend/doc reviewers, which don't reason about
    version-guard trees. Companion to (not replacement for) the
    manual-invoke `polyfill-version-matrix-audit` skill and the
    diff-scope `version-matrix-impact-reviewer` agent.
  - `skills/matrix-cell-onboard/` — checklist + procedure for adding a
    new PHP/Laravel/PHPUnit/Monolog cell to a multi-major library's CI
    matrix. Cross-checks composer constraints, workflow rows, Testbench
    mapping; triggers polyfill-coverage check for the new cell's
    versions.
  - `skills/openspec-artifact-guard/` — `specs` vs `spec-delta` naming
    enforcement and tasks.md ↔ git log drift detection for OpenSpec
    workflows.
  - `skills/library-dual-testsuite-map/` — Core vs Laravel (or
    analogous) testsuite boundary helper.
  - `hooks/post-edit-polyfill-sentinel.sh` — PostToolUse Edit/Write/
    MultiEdit hook; writes `.pending-polyfill-review` when an edited
    `.php` file body matches `guard_patterns`. Fanned out by the core
    `scripts/hooks/post-edit-dispatch.sh` when `library-author` is in
    `DHPK_ACTIVE_MODULES`.
  - `references/polyfill-patterns.md` — severity rubric + catalogued
    guard shapes (`critical`/`high`/`medium`/`low`).
  - `references/openspec-naming-gotchas.md` — `specs` vs `spec-delta`
    artifact gotcha catalogued.
  - `module.yaml` — `library_author.guard_patterns` (default extended
    regex) and `library_author.skip_paths` (path prefixes to exclude).
    Both override-able per project.
- `commands/matrix-cell-onboard.md` — root-level slash alias so
  `/dhpk:matrix-cell-onboard` resolves; thin wrapper that invokes the
  module-scoped skill of the same name when `library-author` is active.

### Fixed (manifest)

- `.claude-plugin/plugin.json` — three latent declaration gaps closed.
  Before this release the module bodies existed in `main` but Claude
  Code never loaded them:
  - `skills[]` did not list `./modules/library-author/skills/` —
    `matrix-cell-onboard` / `openspec-artifact-guard` /
    `library-dual-testsuite-map` were unreachable.
  - No `agents[]` declaration at all — root `./agents/` worked by
    auto-discovery, but module-scoped agents (`polyfill-reviewer`) did
    not. Explicit `agents: ["./agents/", "./modules/library-author/agents/"]`
    closes the gap and future-proofs additional module-scoped agents.
  - No `commands[]` declaration — added `["./commands/"]` for the same
    future-proofing reason.
- `userConfig.modules.description` — adds `library-author` to the ships
  list and documents the sixth-color sentinel wiring.

### Verified

- `claude plugin validate <repo> --strict` passes against schema.
- Cache invalidation round-trip: bumping `version` to `0.3.0` triggers
  Claude Code to re-extract a fresh snapshot into
  `~/.claude/plugins/cache/dhpk/dhpk/0.3.0/` on next session start;
  marketplace pulls latest `main` automatically.
- `polyfill-reviewer` agent visible in `/dhpk:claude-health` agent
  catalog when `library-author` module is enabled.
- `/dhpk:matrix-cell-onboard` resolves to the alias command body and
  delegates to the module skill.

### Upgrade notes

- Existing projects with `library-author` in
  `pluginConfigs.dhpk@dhpk.options.modules` (e.g. `hmj1026/devkit`)
  start receiving the sixth-color sentinel automatically on next
  session — no project-side change required.
- Projects that do NOT need polyfill review can leave `library-author`
  out of their modules list; the new declarations are additive and the
  module ships dormant otherwise.

## 0.2.4 — 2026-05-25 — Honour project-level pluginConfigs overrides

Claude Code injects `userConfig` into hooks via `CLAUDE_PLUGIN_OPTION_*`
env vars, but resolves only the **global** `~/.claude/settings.json`
`pluginConfigs` entry. A developer working on multiple projects with
different stacks (e.g. a Yii 1.1 monolith + a Laravel package library)
saw whichever stack their global config named — even when the project
explicitly declared its own modules in `.claude/settings.local.json`.
Symptom in the wild: `devkit` (a PHP 7.3–8.2 / Laravel 6–11 library)
loaded `php-5.6,yii-1.1,phpunit-5.7,js` because the global config
belonged to a sibling Yii project.

### Added

- `scripts/hooks/_lib/load-project-config.sh` — sourced by every dhpk
  hook entrypoint; reads the project `.claude/settings.local.json`
  (fallback `.claude/settings.json`) and overrides
  `CLAUDE_PLUGIN_OPTION_*` env vars from
  `pluginConfigs.dhpk@dhpk.options.*`. Keys absent from the project
  override are left at the global value (least-surprise: project
  overrides only what it states).

### Fixed

- `scripts/hooks/session-start.sh` — sources the loader before reading
  any plugin option, so module activation, hook profile, and docker
  container list all reflect the project's intent.
- `scripts/hooks/post-edit-dispatch.sh`, `scripts/hooks/pre-bash-dispatch.sh` —
  source the loader and re-derive `DHPK_ACTIVE_MODULES` from
  `CLAUDE_PLUGIN_OPTION_MODULES` when env did not propagate from
  session-start. Module-specific hooks (php-cs-fixer, ESLint, etc.) now
  fire in projects that override modules locally.
- `scripts/hooks/stop-review-reminder.sh` — loader sourced **before**
  `_lib/payload.sh` (which reads `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS`
  at source-time), so per-project `review_agents` overrides reach the
  sentinel reminders.
- `.claude-plugin/plugin.json` — `userConfig.modules.description`
  documents the new precedence rule: project overrides global.

### Precedence (new, documented)

```
project pluginConfigs > global pluginConfigs > userConfig defaults
```

## 0.2.3 — 2026-05-23 — Reduce harness friction in long sessions

A long-running session on a sibling project (`hmj1026/devkit`, Wave-0
closure + Wave-1 implementation, 7 commits) surfaced four high-frequency
friction points in the review-sentinel pipeline. Each was traced back to
a specific script or agent body; this release applies the four fixes
identified in the audit at
`devkit/.claude/artifacts/audits/harness-audit-2026-05-23.md`
(findings #3, #4, #5, #6).

### Fixed

- `scripts/hooks/post-edit-remind.sh` — sentinel append is now idempotent.
  Each `.pending-*` file is checked for the candidate path before write
  (`cut -d' ' -f3- | grep -Fxq`), so repeated edits to the same file no
  longer accumulate duplicate lines. Makes `stop-review-reminder`'s
  `wc -l` count truthful and reduces the work for reviewer agents that
  iterate the sentinel.
- `scripts/hooks/pre-bash-guard.sh` — `git push` block now intersects
  sentinel-listed paths with `git diff --name-only HEAD` (uncommitted)
  ∪ `git diff --name-only --cached` (staged). Stale sentinels from
  already-committed work no longer block pushes — once HEAD moves past
  the edited files, the intersection comes up empty and the push is
  allowed. Eliminates the "rm sentinel, push, rm sentinel, push" loop
  that dominated the devkit session.
- `scripts/hooks/reap-stale-sentinels.sh` — accepts `--threshold-minutes N`
  (default `1440` = 24h, unchanged for the Stop hook caller) and `--clear`
  (auto-rm stale files instead of warn-only). `pre-bash-guard.sh` now
  invokes it with `--threshold-minutes 60 --clear` before its push-block
  check, so a sentinel leaked by a crashed reviewer can't block pushes
  for more than 60 minutes.
- `agents/code-reviewer.md` — stack-aware syntax rules. The agent now
  detects the project's PHP floor from `composer.json` and applies the
  matching ruleset: PHP 5.6/7.0 floor keeps the no-return-types rule;
  PHP 7.1+ floor allows return types, `??`, etc. A new "LSP exceptions"
  block documents that subclass signatures forced by interfaces
  (`PHPUnit\Framework\TestCase::setUp(): void`, `ArrayAccess` tentative
  types, `HttpExceptionInterface` v6+) MUST match the parent — never
  flagged as style violations. Laravel-specific trap list added
  alongside the existing Yii 1.1 traps; both activate only when their
  framework is detected.

### Verified

- `bash scripts/hooks/post-edit-remind.sh` reproducer with two edits to
  the same path → sentinel now has 1 line (was 2 pre-fix).
- `pre-bash-guard.sh` push-block reproducer: commit a doc edit then
  attempt `git push` with sentinel still listing the now-committed file
  → push proceeds (was blocked pre-fix).
- `reap-stale-sentinels.sh --threshold-minutes 60 --clear` against a
  `touch -t 202605220000`-aged sentinel → file removed; subsequent
  `pre-bash-guard.sh` push attempt proceeds.
- `dhpk:code-reviewer` re-run against `tests/Ui/Trail/TrailTest.php`
  (PHPUnit 8+ with `setUp(): void`) → no false positive on the typed
  return declaration; the new LSP-exceptions section is honoured.

## 0.2.2 — 2026-05-22 — Align with current Claude Code plugin CLI

Two regressions surfaced when test-installing v0.2.1 against Claude Code
v2.1.148: the plugin failed to load because Claude now auto-discovers
`hooks/hooks.json` (so the explicit `manifest.hooks` ref produced a
"Duplicate hooks file" load error), and the documented `--plugin-option`
flag no longer exists — the install CLI takes `--config KEY=VALUE`.

### Fixed

- `.claude-plugin/plugin.json` — drop the `"hooks": "./hooks/hooks.json"`
  reference. Claude Code v2.1+ auto-loads the standard hooks path, so the
  explicit reference triggers `Hook load failed: Duplicate hooks file
  detected`. The hook wiring is unchanged on disk; only the redundant
  manifest entry was removed.
- README.md / README.zh-TW.md — replace every `--plugin-option KEY=VALUE`
  example with `--config KEY=VALUE` (the actual flag accepted by
  `claude plugin install`). Drops a Troubleshooting row that referenced
  the obsolete failure mode.
- `scripts/install.sh` — emit `--config` instead of `--plugin-option` in
  the resolved command (the shipped wizard had been emitting an unknown
  CLI flag since the rename).
- `commands/dhpk-setup.md` — point users at `/plugin configure dhpk@dhpk`
  for module changes (the current native in-session configurator) and the
  CLI uninstall+install pair when working from a terminal. The previous
  text referenced `claude plugin reinstall`, which is not a CLI command.
- `docs/docker-setup.md` — same fix in the "disable the check
  temporarily" recipe.
- `manifests/install-profiles.json` and `manifests/module-catalog.json` —
  CLI examples in description/notes strings now use `--config`.
- `docs/design/bootstrap-dhpk-plugin/specs/` — historical design spec
  scenarios use `--config` for consistency. Behavior unchanged; these
  files are archived design notes, not live specs.

### Verified

- `claude plugin marketplace add hmj1026/dhpk` + `claude plugin install
  dhpk@dhpk` on Claude Code v2.1.148 → `Status: ✔ enabled` (previously
  `✘ failed to load`).
- `claude plugin validate ~/projects/dhpk --strict` — passes.

## 0.2.1 — 2026-05-22 — Unbundle OpenSpec wrappers

OpenSpec is now treated as an external optional integration. Generic
OpenSpec wrapper skills/commands are removed from this package — install the
[OpenSpec plugin](https://github.com/Fission-AI/OpenSpec) separately to get
them upstream. dhpk's own value-add helper `opsx-apply-resume` (long-running
OpenSpec session context handoff) is retained and works once OpenSpec is
installed.

### Removed

- 10 skills under `skills/openspec-*/`: `openspec-apply-change`,
  `openspec-archive-change`, `openspec-bulk-archive-change`,
  `openspec-continue-change`, `openspec-explore`, `openspec-ff-change`,
  `openspec-new-change`, `openspec-onboard`, `openspec-sync-specs`,
  `openspec-verify-change`. The 10 matching symlinks under `codex/skills/`
  are removed in parallel.
- `commands/opsx/` — the 10 OpenSpec slash-command wrappers
  (`apply`, `archive`, `bulk-archive`, `continue`, `explore`, `ff`, `new`,
  `onboard`, `sync`, `verify`).
- `"openspec"` keyword from `.claude-plugin/plugin.json`.

### Retained (dhpk's own value-add)

- `skills/opsx-load-context/`, `skills/opsx-post-obs/` — helper skills used
  by `opsx-apply-resume`'s save/resume lifecycle. Still mirrored under
  `codex/skills/`.
- `commands/opsx-apply-resume.md` — the long-running session context
  handoff wrapper. References upstream `openspec-continue-change` as an
  external dependency.
- `scripts/opsx-apply-resume/` — entire bash helper tree (unchanged).

### Moved

- `openspec/changes/bootstrap-dhpk-plugin/` → `docs/design/bootstrap-dhpk-plugin/`.
  The package's original design archive (proposal, design, tasks, specs)
  becomes static reference documentation, no longer OpenSpec-managed. The
  `.openspec.yaml` marker file is dropped along with the move. The
  previous `openspec/` `.gitignore` entry is removed.

### Documentation

- `README.md` / `README.zh-TW.md` — intro paragraph rewritten to call out
  OpenSpec as an external optional integration; counts updated
  (`~75 → ~65` commands, `~60 → ~50` core skills); repository-layout tree
  drops `openspec/` and `commands/opsx/`, gains `docs/design/`.
- `manifests/install-profiles.json` — `minimal` profile description no
  longer claims to ship "openspec workflow skills".
- `docs/recommended-permissions.md` — `Bash(openspec:*)` bullet clarified
  as relevant only when the OpenSpec plugin is installed.
- `skills/multi-ai-sync/references/platform-mapping.md` — header note
  added that `opsx/<cmd>` rows are N/A when OpenSpec is not installed.

### Verification

- `claude plugin validate ~/projects/dhpk --strict` passes.
- `find codex/skills/ -xtype l` returns empty (no dangling symlinks).
- `grep -rln "openspec-" skills/ commands/ agents/` returns only the
  intentional residual references (`multi-ai-sync`, `opsx-apply-resume`).
- `git log --follow docs/design/bootstrap-dhpk-plugin/proposal.md` —
  history not preserved because `openspec/` was `.gitignore`d in prior
  versions; the docs enter git history starting at v0.2.1.

## 0.2.0 — 2026-05-22 — JS module + 5-slot sentinel + deploy-list skill

### Sentinel infrastructure (5 slots)

- `scripts/hooks/_lib/payload.sh` `SENTINEL_NAMES` extends from 3 to 5:
  `.pending-review`, `.pending-db-review`, `.pending-security-review`,
  `.pending-frontend-review`, `.pending-doc-review`. `SENTINEL_LABELS`
  and the default `SENTINEL_AGENTS` extend in parallel. Consumers that
  iterate the array (`clear-sentinel.sh`, `reap-stale-sentinels.sh`,
  `stop-review-reminder.sh`, `pre-bash-guard.sh` push-block) extend
  automatically.
- `userConfig.review_agents` default now ships 5 entries:
  `[code-reviewer, database-reviewer, security-reviewer,
  frontend-reviewer, doc-reviewer]`. Override semantics unchanged.
- `scripts/hooks/post-edit-remind.sh` slot routing: `.md` files under
  harness / docs / openspec paths route to slot 4 (doc-reviewer); JS/TS
  edits still route to slot 0 (code-reviewer) by default; slot 3
  (frontend-reviewer) is fed by the `js` module's `module.yaml` triggers
  when active. `userConfig.review_trigger_extra_paths` now accepts the
  `fe:` and `doc:` slot prefixes in addition to `code:` / `db:` / `sec:`.
- `scripts/hooks/pre-bash-guard.sh` push-block message lists the
  matching agent name per pending sentinel (was: bare filename).
- `scripts/statusline/statusline.sh` `SHORT` labels extend to
  `code / db / sec / fe / doc`.

### New JS module (`modules/js/`)

Hybrid placement: the generic libs (`scripts/hooks/_lib/portable-sed.sh`
landed in v0.1.1, `_lib/payload.sh`) stay in core; JS-specific behaviour
lives in the opt-in module.

- `modules/js/module.yaml` — module manifest. Includes a `js:` block read
  by `js-tier-detect.sh` for `frontend_roots`, `core_files`,
  `vendor_globs` (project curates).
- `modules/js/hooks/_lib/js-tier-detect.sh` — source-only tier detector
  (`frontend / vendor / non-js`). Reads config from `module.yaml`;
  defaults to safe behaviour (everything in `js/` or `src/` subdirs is
  `frontend`).
- `modules/js/hooks/post-edit-js-lint.sh` — async-friendly per-edit
  ESLint feedback (always exits 0; stderr surfaces ≤ 5 findings; 10s
  timeout; silent skip when `npx` / `eslint.config.js` absent).
- `modules/js/hooks/pre-commit-js-validation.sh` — intercepts
  `git commit*`, runs `npm run <lint>` + `npm run <typecheck>` on staged
  JS/TS. Exits 2 to block on failure. `[skip-js-lint]` in the commit
  message bypasses.
- `modules/js/skills/js-lint-config/SKILL.md` — ESLint flat-config tier
  framework (Tier 1 strict / 1.5 core-exempt / 1.6 admin / 1.7
  deferred-migration / 2 tests / Global ignores), custom
  `no-restricted-syntax` AST selectors, legacy-globals three-list sync
  pattern.
- `modules/js/skills/js-static-check-strategy/SKILL.md` — per-leaf
  `// @ts-check` rollout playbook, line-anchored grep trap, leaf
  classification (typedef-widening-fixable vs permanent-exclude),
  tsconfig `exclude` strategy.
- `modules/js/commands/ts-check-status.md` — slash command that scans
  `${CLAUDE_PLUGIN_OPTION_JS_CHECK_PATH:-js/}` and renders the
  strict / transitional / unmarked split.
- `modules/js/references/static-checks.md` — always-loaded index.
- `modules/js/references/frontend-review-patterns.md` —
  `frontend-reviewer`'s grep templates when the module is active.

### Hook wrapper-dispatch model

- `scripts/hooks/post-edit-dispatch.sh` — wraps the existing
  `post-edit-remind.sh` and additionally backgrounds any
  `modules/<m>/hooks/post-edit-*.sh` for active modules.
- `scripts/hooks/pre-bash-dispatch.sh` — wraps `pre-bash-guard.sh` and
  synchronously runs any active module's `pre-bash-*.sh` /
  `pre-commit-*.sh` (non-zero exit blocks the bash call).
- `hooks/hooks.json` — PostToolUse Edit/Write/MultiEdit and PreToolUse
  Bash now point at the dispatchers. Stop / SessionStart wiring
  unchanged.
- `docs/hook-extension.md` — explains the dispatcher contract and how
  to author module hooks.

### New / migrated agents

- `agents/frontend-reviewer.md` — JS/TS reviewer, framework-agnostic.
  Loads `modules/js/references/frontend-review-patterns.md` for
  JS-module-specific detection when the module is active.
- `agents/doc-reviewer.md` — harness / policy / docs reviewer
  (frontmatter check, cross-reference validation, SSOT consistency,
  jargon discoverability). Haiku model.

### New skills

- `skills/deploy-list/` — cross-project / cross-platform deploy file
  list generator (schema=v1). Ships generic / node / python / laravel /
  php-yii presets. `evals/generic/` carries 6 synthetic fixtures (all
  pass byte-identical). `config.sh.example` documents the per-project
  template. `references/extended-presets.example/php-yii-acmeshop.sh`
  is a fully worked DDD-overlay-on-Yii example using a fictional
  company name.
- `skills/execution-checklist/SKILL.md` — end-of-task self-check
  (per-reply / conditional / task-end). Framework-agnostic.

### New userConfig knobs

| Key | Type | Default | Purpose |
|---|---|---|---|
| `js_lint_script` | string | `"lint"` | npm script invoked by JS module's pre-commit gate |
| `js_typecheck_script` | string | `"typecheck"` | npm script invoked by JS module's pre-commit gate |
| `js_check_path` | string | `"js/"` | path scanned by `/ts-check-status` |

`review_agents` default changed (3 → 5). `modules` description updated
to list `js`. `review_trigger_extra_paths` description updated to
mention `fe:` and `doc:` slot prefixes.

### Install profiles

- `manifests/install-profiles.json` adds `js-only` and `js-fullstack`
  profiles. `full` profile now includes `js`.
- `manifests/module-catalog.json` registers the `js` stack and the
  two new review slots (`fe`, `doc`).
- `scripts/install.sh` interactive flow prompts for all 5 reviewer
  agent names when the override-defaults branch is taken.

### Documentation

- `docs/hook-extension.md` — wrapper-dispatch contract + module-hook
  authoring guide.
- `docs/recommended-permissions.md` — recommended
  `.claude/settings.local.json` `permissions.allow` catalogue by stack
  (universal, PHP/Yii, JS/Node, Python, auxiliary). Plugin manifest
  does **not** ship permissions; this is reference documentation.

### Verification

- Repo-wide identifier audit: zero leaks of origin-project names,
  project-private class symbols, project-specific JS namespace, or
  project-specific repository-layer path. Negative-assertion eval files
  in `codex/skills/legacy-code-characterization/` and
  `modules/phpunit-5.7/skills/legacy-code-characterization/` are
  intentional — they assert agent outputs MUST NOT contain a list of
  enumerated names; those names appear in the eval *as the forbidden
  list*, not as live content.
- `bash -n` clean on all new and modified shell scripts.
- 5-slot sentinel end-to-end: `clear-sentinel.sh` derives whitelist
  from `SENTINEL_NAMES`; `pre-bash-guard.sh` push-block names all 5
  pending sentinels with their matching agent name.
- `skills/deploy-list/scripts/check-golden.sh` — generic suite 6/6
  PASS after the cross-project genericisation.

## 0.1.1 — 2026-05-22 — Cross-platform lib + sentinel resilience

Low-risk infrastructure additions. No behavioural change in the default
profile; all new behaviour is opt-in via `userConfig`.

### Added

- **`scripts/hooks/_lib/portable-sed.sh`** — source-only cross-platform `sed -i`
  wrapper (Linux/WSL GNU sed vs macOS BSD sed). Exposes `sed_inplace`. Reserved
  for future hooks that need in-place edits; the v0.1.1 hook set does not yet
  consume it.
- **`scripts/hooks/reap-stale-sentinels.sh`** — Stop-hook companion that
  inspects `.claude/artifacts/sessions/.pending-*` files and emits a STALE
  warning to stderr when any sentinel is older than 24h (likely review-agent
  crash). By design does not delete; prints the exact `clear-sentinel.sh`
  command to clear manually. Uses portable `stat` (Linux `-c %Y` / macOS
  `-f %m`). Wired into the Stop event as a second `async: true` hook.
- **`reap_stale_mcp_processes` userConfig** (boolean, default `false`) —
  when enabled, `session-start.sh` reaps older `gitnexus mcp` processes and
  keeps only the newest. Off by default; only useful for projects using the
  gitnexus MCP server. Skipped automatically when `pgrep` is missing.

### Changed

- **`scripts/hooks/clear-sentinel.sh`** — now sources `_lib/payload.sh` and
  derives `KNOWN_SENTINELS` from `SENTINEL_NAMES`. Behaviour identical
  today (3-slot) but automatically extensible when `SENTINEL_NAMES` grows.
- **`commands/code-review.md` → `commands/review-pending.md`** — renamed for
  naming clarity ("review the **pending** files" vs. "the `code-reviewer`
  agent"). Old name retained as a deprecated forwarding stub; will be
  removed in v1.0.0. `commands/INDEX.md` updated accordingly.
- **De-identification sweep** across `agents/refactor-cleaner.md`,
  `skills/git-smart-commit/SKILL.md`, `skills/pr-review/SKILL.md`,
  `skills/pr-review/scripts/check-unrelated-changes.sh`,
  `skills/harness-revise/scripts/harness-inventory.sh`, and
  `codex/skills/multi-ai-sync/scripts/multi_ai_sync_lib/agent_sync.py`:
  removed lingering origin-project identifiers and replaced them with
  generic placeholders / framework-agnostic phrasing.

### Verification

- `bash -n` clean on all modified shell scripts.
- Repo-wide identifier audit returns no matches for any origin-project name.
- Stop hook smoke: touched a stub sentinel with mtime > 24h; reap script
  printed `[reap-sentinels] STALE: ...` and exited 0 without deleting the
  file.
- `clear-sentinel.sh --all` still clears all three known sentinels with the
  refactor in place.

## 0.1.0 — 2026-05-21 — Initial release

First public release of `dhpk` — a generic, install-and-go Claude Code harness with an opt-in stack-module system and a parallel Codex CLI tree.

### Added

- **Plugin manifest** (`.claude-plugin/plugin.json`) with five `userConfig` knobs (see below).
- **Marketplace manifest** (`.claude-plugin/marketplace.json`) — single-entry catalog pointing at the repo root.
- **13 agents** under the `dhpk:` namespace (12 role-based + 1 `INDEX.md`): `architect`, `code-reviewer`, `database-reviewer`, `performance-analyzer`, `refactor-cleaner`, `security-reviewer`, `tdd-guide`, etc. Frontmatter descriptions are framework-agnostic; each notes the matching dhpk module for stack-specific traps.
- **74 commands** including `opsx/*` (10 OpenSpec workflow wrappers), `codex-*`, `code-review`, `create-pr`, `smart-commit`, `precommit`, `harness-audit`, `pr-review`, `feature-dev`, `feature-verify`, etc.
- **59 core skills + 5 module skills** (across 3 stack modules). Two new rules-as-skills: `tool-routing` and `dhpk-execution-policy`.
- **3 opt-in stack modules** with `module.yaml` metadata, skills, and references:
  - `php-5.6` — PHP 5.6 language baseline.
  - `yii-1.1` — Yii 1.1 framework (requires `php-5.6`).
  - `phpunit-5.7` — PHPUnit 5.7 patterns (requires `php-5.6`).
- **Sentinel-driven review hooks** (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`) with parameterised agent names, trigger paths, docker checks, and hook profile. Explicit `[hook-name] WARN: …` lines when modules are enabled but `python3` is missing.
- **8 hook scripts** under `scripts/hooks/`, including `_lib/payload.sh` (sentinel-array override via `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS`), `post-edit-remind.sh`, `post-write-crlf-fix.sh` (with `python3` JSON-parse fallback when `jq` is absent), and `install-codex-skills.sh` for dual-track Codex CLI sync (symlink default, `--copy`, `--update`, `--force`; advisory `note:` when Codex CLI binary is missing from PATH).
- **Harness scripts**: `harness-audit.js`, `precommit-runner.js`, `verify-runner.js`, `gemini-adapt-agents.js`, `dep-audit.sh`, `codemaps/generate.ts`, `validate/validate-harness.sh`, `opsx-apply-resume/*.sh`.
- **Statusline script** (`scripts/statusline/statusline.sh`) — opt-in via project `settings.json`. Renders branch, staged/modified counts, docker status, profile, active modules, pending sentinels.
- **24 codex skills + 5 codex agents** under `codex/` for dual-assistant projects.
- **`manifests/install-profiles.json`** — curated module bundles (`minimal`, `legacy-php-yii`, `php-only`, `full`).
- **`codex/AGENTS.md`** — dual-harness expectations document.
- **`docs/subagent-prompt-template.md`** — source-reading and DB-access boilerplate to paste into sub-agent prompts.

### `userConfig`

| Key | Default | Purpose |
|-----|---------|---------|
| `hook_profile` | `"standard"` | Verbosity of hook output: `minimal` \| `standard` \| `strict` |
| `review_agents` | `["code-reviewer","database-reviewer","security-reviewer"]` | Three agents invoked by sentinel reminders (code, database, security) |
| `docker_containers` | `[]` | Container names checked at `SessionStart`; empty disables the check |
| `modules` | `[]` | Stack modules to enable; `requires:` validated at `SessionStart` (warning only) |
| `review_trigger_extra_paths` | `[]` | Extra path prefixes per reviewer slot, format `<slot>:<prefix>` where slot ∈ `code\|db\|sec` |

### Verification

- `claude plugin validate ~/projects/dhpk --strict` passes.
- Hook smoke tests:
  - `post-edit-remind.sh` writes `.pending-review` for a `.php` edit even with `python3` PATH-masked (extension default still fires).
  - `post-write-crlf-fix.sh` normalises CRLF with `jq` missing (`python3` fallback works).
- End-to-end install round-trip in a scratch project succeeded: `claude plugin marketplace add ~/projects/dhpk` → `claude plugin install dhpk@dhpk` → `claude plugin details dhpk` reports 127 skill+command entries, 13 agents, 4 hook events.
- `install-codex-skills.sh` populated `.codex/skills/` + `.codex/agents/` with symlinks; re-run printed `already up-to-date for dhpk v0.1.0`.

### Known limitations

- Some skill bodies and command bodies inside `skills/`, `modules/`, `codex/skills/` still reference PHP/Yii-flavored examples (e.g. `protected/`, AR patterns) without explicit "this is just an example" framing. These do not affect functionality on non-PHP projects but may confuse first-time readers. Deeper rewrites planned for v0.2.
