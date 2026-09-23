# Codex skill usage discovery

<!-- GENERATED: inventory-owned Usage Grammar. Do not edit manually. -->

Source inventory revision: `sha256:b2de9604027d1af95634c4581547fcff1ac365bb2da114ebac0a754ea4ae4a7d`. Use `$flow-guide help` for read-only progressive usage cards.

## Available skills

### `$code-simplify`

Summary: Clean changed code without changing behavior
Syntax: `$code-simplify [<target>]`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `target` `<target>` (optional, string) — PR, branch, file, or directory

Actions:
- `simplify` `$code-simplify [<target>]` — Apply bounded cleanup with test evidence

Examples:
- `$code-simplify src/` — Use code simplify with its declared interface

### `$code-trace`

Summary: Trace code paths, causes, history, or navigation tools
Syntax: `$code-trace [--mode=<mode>] <query>`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Inputs:
- `query` `<query>` (required, string) — Describe the symbol, failure, or history to trace

Actions:
- `explore` `$code-trace --mode=explore <query>` — Trace an unfamiliar symbol, file, module, or flow
- `diagnose` `$code-trace --mode=diagnose <query>` — Confirm the cause of a failure or regression
- `history` `$code-trace --mode=history <query>` — Investigate when and why behavior changed
- `select-tool` `$code-trace --mode=select-tool <query>` — Select one code-navigation tool and fallback

Options:
- `mode` `--mode=<mode>` (optional, enum, values=explore|diagnose|history|select-tool) — Choose the code-trace mode
- `dual` `--dual` (optional, boolean, default=false) — Request an independent read-only perspective
- `explain` `--explain` (optional, boolean, default=false) — Request a bounded explanation of the trace
- `depth` `--depth=<brief|normal|deep>` (optional, enum, values=brief|normal|deep) — Set the requested explanation depth

Examples:
- `$code-trace --mode=explore OrderService` — Trace callers and callees for an unfamiliar symbol

### `$create-pr`

Summary: Create a ticket-aware pull request with a safe dry-run boundary
Syntax: `$create-pr [--head=<branch>] [--base=<branch>] [--title=<text>] [--execute] [--dry-run]`
Invocation class: `explicit-only`
Maximum authority: `external-write`

Actions:
- `create` `$create-pr [--execute]` — Create or preview one pull request

Options:
- `head` `--head=<branch>` (optional, string) — Use this source branch
- `base` `--base=<branch>` (optional, string) — Use this target branch
- `title` `--title=<text>` (optional, string) — Override the generated title
- `execute` `--execute` (optional, boolean, default=false) — Perform the explicit remote create
- `dry-run` `--dry-run` (optional, boolean, default=true) — Preview without remote mutation

Examples:
- `$create-pr --dry-run` — Use create pr with its declared interface

### `$dep-audit`

Summary: Audit dependency risks with a separate explicit fix boundary
Syntax: `$dep-audit [--level=<severity>] [--fix]`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Actions:
- `audit` `$dep-audit` — Audit dependency vulnerabilities and optional fixes

Options:
- `level` `--level=<severity>` (optional, enum, values=low|moderate|high|critical, default=moderate) — Minimum severity to report
- `fix` `--fix` (optional, boolean, default=false) — Run the explicitly requested fix operation

Examples:
- `$dep-audit --level=high` — Use dependency audit with its declared interface

### `$dhpk-legacy-characterization-tests`

Summary: Lock observed legacy behavior before refactoring safely
Syntax: `$dhpk-legacy-characterization-tests <legacy-target>`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `legacy-target` `<legacy-target>` (required, string) — Select the legacy code target to characterize

Actions:
- `characterize` `$dhpk-legacy-characterization-tests <legacy-target>` — Write tests that capture the current legacy behavior

Examples:
- `$dhpk-legacy-characterization-tests protected/models/Order.php` — Lock an untested legacy model before refactoring

### `$dhpk-opsx-load-context`

Summary: Load resume context through the deterministic fallback chain
Syntax: `$dhpk-opsx-load-context`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Actions:
- `load` `$dhpk-opsx-load-context` — Resolve the best available resume context

Examples:
- `$dhpk-opsx-load-context` — Load context for an opsx-apply-resume session

### `$dhpk-opsx-post-observation`

Summary: Post one resume observation through the observer boundary
Syntax: `$dhpk-opsx-post-observation <observation-context>`
Invocation class: `implicit-eligible`
Maximum authority: `delegate`

Inputs:
- `observation-context` `<observation-context>` (required, string) — Describe the compact session observation

Actions:
- `post` `$dhpk-opsx-post-observation <observation-context>` — Submit the compact session observation

Examples:
- `$dhpk-opsx-post-observation save-phase summary` — Post the observation during opsx save phase

### `$dhpk-php-runtime-router`

Summary: Detect PHP runtime and select safe framework guidance
Syntax: `$dhpk-php-runtime-router <php-task>`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Inputs:
- `php-task` `<php-task>` (required, string) — Describe the PHP or framework task

Actions:
- `route` `$dhpk-php-runtime-router <php-task>` — Detect the runtime and select matching references

Examples:
- `$dhpk-php-runtime-router review this Yii 1.1 controller` — Select PHP-compatible guidance for a backend task

### `$dhpk-yii1-php56-development`

Summary: Implement Yii 1.x backend changes with PHP 5.6-safe tests
Syntax: `$dhpk-yii1-php56-development <backend-task>`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `backend-task` `<backend-task>` (required, string) — Describe the Yii backend implementation task

Actions:
- `implement` `$dhpk-yii1-php56-development <backend-task>` — Design, test, and implement a Yii 1.x backend change

Examples:
- `$dhpk-yii1-php56-development fix this Yii 1.1 controller` — Apply PHP 5.6-safe backend implementation guidance

### `$dhpk-yii1-security-audit`

Summary: Audit Yii 1.1 security boundaries with evidence and fixes
Syntax: `$dhpk-yii1-security-audit <source-path> [--output-path=<path>]`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Inputs:
- `source-path` `<source-path>` (required, string) — Select the Yii source path to audit

Actions:
- `audit` `$dhpk-yii1-security-audit <source-path> [--output-path=<path>]` — Inspect Yii 1.1 framework security boundaries

Options:
- `output-path` `--output-path=<path>` (optional, string) — Choose the audit report output directory

Examples:
- `$dhpk-yii1-security-audit protected` — Audit a Yii 1.1 project for framework security issues

### `$doc-refactor`

Summary: Refactor one bounded Markdown document while preserving facts
Syntax: `$doc-refactor <file-path>`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `file-path` `<file-path>` (required, string) — One Markdown document

Actions:
- `refactor` `$doc-refactor <file-path>` — Rewrite one bounded document and validate its links

Examples:
- `$doc-refactor docs/guide.md` — Use doc refactor with its declared interface

### `$flow-drive`

Summary: Implement a confirmed specification with bounded evidence
Syntax: `$flow-drive <confirmed-spec-or-change-id> [--plan[=<model>:<effort>]] [--worker=<worker>] [--worker-target=<provider>/<model>[:<effort>]] [--cross-provider] [--reasoner=<provider>/<model>[:<effort>]] [--architect|--no-architect]`
Invocation class: `explicit-only`
Maximum authority: `workspace-write`

Inputs:
- `confirmed-spec-or-change-id` `<confirmed-spec-or-change-id>` (required, string) — Select the confirmed specification or change

Actions:
- `apply` `$flow-drive <confirmed-spec-or-change-id>` — Implement the confirmed specification or OpenSpec change

Options:
- `plan` `--plan[=<model>:<effort>]` (optional, string) — Request a planning pass before implementation
- `worker` `--worker=<worker>` (optional, enum, values=claude|codex|agy|auto) — Select an explicitly requested implementation worker
- `worker-target` `--worker-target=<provider>/<model>[:<effort>]` (optional, string) — Select an explicit provider, model, and effort target
- `cross-provider` `--cross-provider` (optional, boolean, default=false) — Allow the explicitly selected provider boundary
- `reasoner` `--reasoner=<provider>/<model>[:<effort>]` (optional, string) — Request a bounded second opinion
- `architect` `--architect` (optional, boolean) — Enable the architecture pass
- `no-architect` `--no-architect` (optional, boolean) — Disable the architecture pass

Legacy diagnostics (not primary syntax):
- `--codex` — Use an explicit worker, worker-target, or reasoner instead of the retired Codex shortcut

Examples:
- `$flow-drive consolidate-remaining-dhpk-skill-families` — Implement a confirmed OpenSpec change

### `$flow-guide`

Summary: Guide routes, rules, next steps, closeout, and usage help
Syntax: `$flow-guide <help|route|rules|next|close> [--go] [<query>]`
Invocation class: `implicit-eligible`
Maximum authority: `delegate`

Inputs:
- `action` `<help|route|rules|next|close>` (required, enum, values=help|route|rules|next|close) — Choose one read-only guide action
- `query` `<query>` (optional, string) — Provide the action-specific skill or workflow text

Actions:
- `help` `$flow-guide help [<skill>]` — Show available Codex usage or one usage card
- `route` `$flow-guide route [--go] [<query>]` — Select the smallest workflow owner for a task
- `rules` `$flow-guide rules [<query>]` — Look up the governing workflow rules
- `next` `$flow-guide next [<query>]` — Identify the next bounded workflow action
- `close` `$flow-guide close [<query>]` — Check closeout evidence and remaining gates

Options:
- `go` `--go` (optional, boolean, default=false) — Request one bounded handoff when the route is eligible

Examples:
- `$flow-guide help` — List the available Codex skill usage contracts

### `$git-smart-commit`

Summary: Group related changes into reviewable commits safely
Syntax: `$git-smart-commit [--scope=<path>] [--type=<type>] [--ai-co-author]`
Invocation class: `explicit-only`
Maximum authority: `git-write`

Actions:
- `group` `$git-smart-commit [--scope=<path>] [--type=<type>] [--ai-co-author]` — Analyze changes and produce grouped commit steps

Options:
- `scope` `--scope=<path>` (optional, string) — Limit status and diff collection
- `type` `--type=<type>` (optional, enum, values=feat|fix|docs|refactor|style|chore|test) — Force a conventional commit type
- `ai-co-author` `--ai-co-author` (optional, boolean, default=false) — Opt into the project-approved AI trailer

Examples:
- `$git-smart-commit --scope=src/` — Use git smart commit with its declared interface

### `$git-worktree`

Summary: Manage native Git worktrees with confirmation boundaries
Syntax: `$git-worktree [<operation>] [--branch=<name>] [--base=<ref>]`
Invocation class: `explicit-only`
Maximum authority: `git-write`

Inputs:
- `operation` `<operation>` (optional, enum, values=add|list|remove|prune, default=list) — Worktree operation

Actions:
- `manage` `$git-worktree [<operation>]` — Add, list, remove, or prune a worktree

Options:
- `branch` `--branch=<name>` (optional, string) — Branch used by add or remove
- `base` `--base=<ref>` (optional, string) — Base ref used when adding

Examples:
- `$git-worktree list` — Use git worktree with its declared interface

### `$harness-audit`

Summary: Audit repository harness health with a deterministic scorecard
Syntax: `$harness-audit [<scope>] [--format=<format>] [--root=<path>]`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Inputs:
- `scope` `<scope>` (optional, enum, values=repo|hooks|skills|commands|agents, default=repo) — Harness area to inspect

Actions:
- `audit` `$harness-audit [<scope>]` — Run the deterministic harness audit

Options:
- `format` `--format=<format>` (optional, enum, values=text|json, default=text) — Output format
- `root` `--root=<path>` (optional, string) — Consumer repository root

Examples:
- `$harness-audit skills --format=json` — Use harness audit with its declared interface

### `$harness-govern`

Summary: Govern harness health, budget, filling, revision, and sync
Syntax: `$harness-govern <health|budget|fill|revise|sync> [options]`
Invocation class: `explicit-only`
Maximum authority: `external-write`

Inputs:
- `mode` `<health|budget|fill|revise|sync>` (required, enum, values=health|budget|fill|revise|sync) — Choose one harness governance mode

Actions:
- `health` `$harness-govern health [options]` — Check harness structure and optionally fix safe issues
- `budget` `$harness-govern budget [options]` — Measure harness context cost and ranked savings
- `fill` `$harness-govern fill [options]` — Preview or apply missing harness layers
- `revise` `$harness-govern revise [options]` — Review and revise an active harness
- `sync` `$harness-govern sync [options]` — Plan or apply cross-platform harness synchronization

Options:
- `dir` `--dir=<path>` (optional, string) — Select the harness directory
- `dry-run` `--dry-run` (optional, boolean, default=false) — Preview changes without writing
- `fix-safe` `--fix-safe` (optional, boolean, default=false) — Apply only approved safe health fixes
- `fix` `--fix` (optional, boolean, default=false) — Apply the selected health fixes

Examples:
- `$harness-govern health --dry-run` — Inspect harness health without changing files

### `$js-static-check-strategy`

Summary: Plan staged TypeScript checks and inspect strict-check progress
Syntax: `$js-static-check-strategy status [--path=<path>]`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Actions:
- `status` `$js-static-check-strategy status [--path=<path>]` — Report the current static-check status

Options:
- `path` `--path=<path>` (optional, string) — Frontend root to scan

Examples:
- `$js-static-check-strategy status --path=js/` — Use js static check strategy with its declared interface

### `$matrix-cell-onboard`

Summary: Plan and optionally apply one multi-major CI matrix cell
Syntax: `$matrix-cell-onboard <php-version> <laravel-version> [<phpunit>] [<monolog>]`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `php-version` `<php-version>` (required, string) — PHP runtime version
- `laravel-version` `<laravel-version>` (required, string) — Laravel version
- `phpunit` `<phpunit>` (optional, string) — PHPUnit version
- `monolog` `<monolog>` (optional, string) — Monolog version

Actions:
- `onboard` `$matrix-cell-onboard <php-version> <laravel-version>` — Plan and apply one matrix cell

Examples:
- `$matrix-cell-onboard 8.3 12 11 3` — Use matrix cell onboard with its declared interface

### `$merge-prep`

Summary: Analyze a branch merge without mutating the repository
Syntax: `$merge-prep <source-branch> [--target=<branch>]`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Inputs:
- `source-branch` `<source-branch>` (required, string) — Branch to analyze

Actions:
- `prepare` `$merge-prep <source-branch>` — Analyze merge conflicts and manual commands

Options:
- `target` `--target=<branch>` (optional, string) — Target branch for the analysis

Examples:
- `$merge-prep feature/topic --target=main` — Use merge prep with its declared interface

### `$pr-summary`

Summary: Summarize open pull requests with evidence
Syntax: `$pr-summary [--author=<user>] [--label=<label>]`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Actions:
- `summarize` `$pr-summary` — Group accessible open pull requests

Options:
- `author` `--author=<user>` (optional, string) — Filter by pull-request author
- `label` `--label=<label>` (optional, string) — Filter by pull-request label

Examples:
- `$pr-summary --label=ready` — Use pr summary with its declared interface

### `$precommit`

Summary: Run the packaged deterministic pre-commit pipeline
Syntax: `$precommit [--fast]`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Actions:
- `run` `$precommit [--fast]` — Run fast or full pre-commit stages

Options:
- `fast` `--fast` (optional, boolean, default=false) — Run the fast stage set

Examples:
- `$precommit --fast` — Use precommit with its declared interface

### `$project-brief`

Summary: Convert one technical specification into an executive brief
Syntax: `$project-brief <tech-spec-path> [--output=<output-path>]`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `tech-spec-path` `<tech-spec-path>` (required, string) — Readable technical specification

Actions:
- `brief` `$project-brief <tech-spec-path>` — Write an executive summary without changing the source

Options:
- `output` `--output=<output-path>` (optional, string) — Destination for the brief

Examples:
- `$project-brief docs/spec.md --output=docs/brief.md` — Use project brief with its declared interface

### `$proposal-analyze`

Summary: Turn a proposal into an evidence-backed implementation roadmap
Syntax: `$proposal-analyze <proposal>`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `proposal` `<proposal>` (required, string) — Proposal text or file path

Actions:
- `analyze` `$proposal-analyze <proposal>` — Research a proposal and produce a roadmap

Examples:
- `$proposal-analyze openspec/changes/example/proposal.md` — Use proposal analyze with its declared interface

### `$release-creator`

Summary: Prepare or publish a validated release with a human gate
Syntax: `$release-creator <version> [--execute]`
Invocation class: `explicit-only`
Maximum authority: `external-write`

Inputs:
- `version` `<version>` (required, string) — Release version

Actions:
- `release` `$release-creator <version> [--execute]` — Prepare or publish one release

Options:
- `execute` `--execute` (optional, boolean, default=false) — Proceed past the human release gate

Examples:
- `$release-creator 0.62.4 --execute` — Use release creator with its declared interface

### `$repo-verify`

Summary: Run runner-first repository verification with explicit evidence
Syntax: `$repo-verify [<mode>] [--integration=<path>] [--e2e=<path>]`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Inputs:
- `mode` `<mode>` (optional, enum, values=fast|full, default=full) — Verification depth

Actions:
- `verify` `$repo-verify [<mode>]` — Run fast or full repository verification

Options:
- `integration` `--integration=<path>` (optional, string) — Run the named integration stage
- `e2e` `--e2e=<path>` (optional, string) — Run the named end-to-end stage

Examples:
- `$repo-verify fast` — Use repo verify with its declared interface

### `$review-pending`

Summary: Delegate a read-only pending-change review
Syntax: `$review-pending [--files=<rel-paths>]`
Invocation class: `implicit-eligible`
Maximum authority: `delegate`

Actions:
- `review` `$review-pending` — Delegate the selected pending files to code-reviewer

Options:
- `files` `--files=<rel-paths>` (optional, string) — Comma-separated relative file paths

Examples:
- `$review-pending --files=src/a.js` — Use review pending with its declared interface

### `$skill-scope`

Summary: Route skill governance to one focused mode with evidence
Syntax: `$skill-scope <health|judge|stocktake|scout>`
Invocation class: `implicit-eligible`
Maximum authority: `delegate`

Inputs:
- `mode` `<health|judge|stocktake|scout>` (required, enum, values=health|judge|stocktake|scout) — Choose one skill governance mode
- `target` `<target>` (optional, string) — Select the skill or capability to inspect

Actions:
- `health` `$skill-scope health <skill>` — Check one skill or package structure
- `judge` `$skill-scope judge <skill>` — Score one skill or package quality
- `stocktake` `$skill-scope stocktake` — Audit installed consumer skills and commands
- `scout` `$skill-scope scout <capability>` — Search for an existing skill or capability

Examples:
- `$skill-scope health flow-guide` — Run a focused health check for one skill

### `$spec-mine`

Summary: Extract one capability baseline into an OpenSpec behavioral spec
Syntax: `$spec-mine [<capability-or-path>]`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `capability-or-path` `<capability-or-path>` (optional, string) — Capability or path to mine first

Actions:
- `mine` `$spec-mine [<capability-or-path>]` — Write one bounded behavioral baseline

Examples:
- `$spec-mine billing` — Use spec mine with its declared interface

### `$tdd-workflow`

Summary: Drive behavior-first tests through a minimal red-green loop
Syntax: `$tdd-workflow [test-generation] <task>`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `mode` `<test-generation>` (optional, enum, values=test-generation) — Optionally request test scaffold generation
- `task` `<task>` (required, string) — Describe the behavior-first development task

Actions:
- `tdd` `$tdd-workflow <task>` — Guide a behavior-first test and implementation loop
- `test-generation` `$tdd-workflow test-generation <target>` — Generate a focused failing-test scaffold

Examples:
- `$tdd-workflow test-generation tests/OrderTest.php` — Use tdd with its declared interface

### `$update-codemaps`

Summary: Refresh architecture codemaps from the live project structure
Syntax: `$update-codemaps`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Actions:
- `update` `$update-codemaps` — Refresh the bounded architecture codemaps

Examples:
- `$update-codemaps` — Use update codemaps with its declared interface

### `$update-docs`

Summary: Update a bounded user or agent document from live evidence
Syntax: `$update-docs <docs-path-or-workflow-keyword>`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `target` `<docs-path-or-workflow-keyword>` (required, string) — Documentation path or workflow keyword

Actions:
- `update` `$update-docs <docs-path-or-workflow-keyword>` — Update owned documentation and its locale pair

Examples:
- `$update-docs docs/configuration.md` — Use update docs with its declared interface
