# Codex 技能使用發現

<!-- GENERATED: inventory-owned Usage Grammar. Do not edit manually. -->

來源 inventory revision：`sha256:cce5b750f0a8919f282d99784c312e0b6805aaf34b49c5a5e7296984fb829392`。使用 `$flow-guide help` 取得唯讀、逐步揭露的參數卡。

## 可用技能

### `$code-simplify`

摘要：Clean changed code without changing behavior
語法：`$code-simplify [<target>]`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `target` `<target>` (可選, string) — PR, branch, file, or directory

Actions：
- `simplify` `$code-simplify [<target>]` — Apply bounded cleanup with test evidence

範例：
- `$code-simplify src/` — Use code simplify with its declared interface

### `$code-trace`

摘要：Trace code paths, causes, history, or navigation tools
語法：`$code-trace [--mode=<mode>] <query>`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

輸入：
- `query` `<query>` (必要, string) — Describe the symbol, failure, or history to trace

Actions：
- `explore` `$code-trace --mode=explore <query>` — Trace an unfamiliar symbol, file, module, or flow
- `diagnose` `$code-trace --mode=diagnose <query>` — Confirm the cause of a failure or regression
- `history` `$code-trace --mode=history <query>` — Investigate when and why behavior changed
- `select-tool` `$code-trace --mode=select-tool <query>` — Select one code-navigation tool and fallback

選項：
- `mode` `--mode=<mode>` (可選, enum, values=explore|diagnose|history|select-tool) — Choose the code-trace mode
- `dual` `--dual` (可選, boolean, default=false) — Request an independent read-only perspective
- `explain` `--explain` (可選, boolean, default=false) — Request a bounded explanation of the trace
- `depth` `--depth=<brief|normal|deep>` (可選, enum, values=brief|normal|deep) — Set the requested explanation depth

範例：
- `$code-trace --mode=explore OrderService` — Trace callers and callees for an unfamiliar symbol

### `$create-pr`

摘要：Create a ticket-aware pull request with a safe dry-run boundary
語法：`$create-pr [--head=<branch>] [--base=<branch>] [--title=<text>] [--execute] [--dry-run]`
呼叫類別：`explicit-only`
最高 authority：`external-write`

Actions：
- `create` `$create-pr [--execute]` — Create or preview one pull request

選項：
- `head` `--head=<branch>` (可選, string) — Use this source branch
- `base` `--base=<branch>` (可選, string) — Use this target branch
- `title` `--title=<text>` (可選, string) — Override the generated title
- `execute` `--execute` (可選, boolean, default=false) — Perform the explicit remote create
- `dry-run` `--dry-run` (可選, boolean, default=true) — Preview without remote mutation

範例：
- `$create-pr --dry-run` — Use create pr with its declared interface

### `$dep-audit`

摘要：Audit dependency risks with a separate explicit fix boundary
語法：`$dep-audit [--level=<severity>] [--fix]`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

Actions：
- `audit` `$dep-audit` — Audit dependency vulnerabilities and optional fixes

選項：
- `level` `--level=<severity>` (可選, enum, values=low|moderate|high|critical, default=moderate) — Minimum severity to report
- `fix` `--fix` (可選, boolean, default=false) — Run the explicitly requested fix operation

範例：
- `$dep-audit --level=high` — Use dependency audit with its declared interface

### `$dhpk-legacy-characterization-tests`

摘要：Lock observed legacy behavior before refactoring safely
語法：`$dhpk-legacy-characterization-tests <legacy-target>`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `legacy-target` `<legacy-target>` (必要, string) — Select the legacy code target to characterize

Actions：
- `characterize` `$dhpk-legacy-characterization-tests <legacy-target>` — Write tests that capture the current legacy behavior

範例：
- `$dhpk-legacy-characterization-tests protected/models/Order.php` — Lock an untested legacy model before refactoring

### `$dhpk-opsx-load-context`

摘要：Load resume context through the deterministic fallback chain
語法：`$dhpk-opsx-load-context`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

Actions：
- `load` `$dhpk-opsx-load-context` — Resolve the best available resume context

範例：
- `$dhpk-opsx-load-context` — Load context for an opsx-apply-resume session

### `$dhpk-opsx-post-observation`

摘要：Post one resume observation through the observer boundary
語法：`$dhpk-opsx-post-observation <observation-context>`
呼叫類別：`implicit-eligible`
最高 authority：`delegate`

輸入：
- `observation-context` `<observation-context>` (必要, string) — Describe the compact session observation

Actions：
- `post` `$dhpk-opsx-post-observation <observation-context>` — Submit the compact session observation

範例：
- `$dhpk-opsx-post-observation save-phase summary` — Post the observation during opsx save phase

### `$dhpk-php-runtime-router`

摘要：Detect PHP runtime and select safe framework guidance
語法：`$dhpk-php-runtime-router <php-task>`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

輸入：
- `php-task` `<php-task>` (必要, string) — Describe the PHP or framework task

Actions：
- `route` `$dhpk-php-runtime-router <php-task>` — Detect the runtime and select matching references

範例：
- `$dhpk-php-runtime-router review this Yii 1.1 controller` — Select PHP-compatible guidance for a backend task

### `$dhpk-yii1-php56-development`

摘要：Implement Yii 1.x backend changes with PHP 5.6-safe tests
語法：`$dhpk-yii1-php56-development <backend-task>`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `backend-task` `<backend-task>` (必要, string) — Describe the Yii backend implementation task

Actions：
- `implement` `$dhpk-yii1-php56-development <backend-task>` — Design, test, and implement a Yii 1.x backend change

範例：
- `$dhpk-yii1-php56-development fix this Yii 1.1 controller` — Apply PHP 5.6-safe backend implementation guidance

### `$dhpk-yii1-security-audit`

摘要：Audit Yii 1.1 security boundaries with evidence and fixes
語法：`$dhpk-yii1-security-audit <source-path> [--output-path=<path>]`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

輸入：
- `source-path` `<source-path>` (必要, string) — Select the Yii source path to audit

Actions：
- `audit` `$dhpk-yii1-security-audit <source-path> [--output-path=<path>]` — Inspect Yii 1.1 framework security boundaries

選項：
- `output-path` `--output-path=<path>` (可選, string) — Choose the audit report output directory

範例：
- `$dhpk-yii1-security-audit protected` — Audit a Yii 1.1 project for framework security issues

### `$doc-refactor`

摘要：Refactor one bounded Markdown document while preserving facts
語法：`$doc-refactor <file-path>`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `file-path` `<file-path>` (必要, string) — One Markdown document

Actions：
- `refactor` `$doc-refactor <file-path>` — Rewrite one bounded document and validate its links

範例：
- `$doc-refactor docs/guide.md` — Use doc refactor with its declared interface

### `$flow-drive`

摘要：Implement a confirmed specification with bounded evidence
語法：`$flow-drive <confirmed-spec-or-change-id> [--plan[=<model>:<effort>]] [--worker=<worker>] [--worker-target=<provider>/<model>[:<effort>]] [--cross-provider] [--reasoner=<provider>/<model>[:<effort>]] [--architect|--no-architect]`
呼叫類別：`explicit-only`
最高 authority：`workspace-write`

輸入：
- `confirmed-spec-or-change-id` `<confirmed-spec-or-change-id>` (必要, string) — Select the confirmed specification or change

Actions：
- `apply` `$flow-drive <confirmed-spec-or-change-id>` — Implement the confirmed specification or OpenSpec change

選項：
- `plan` `--plan[=<model>:<effort>]` (可選, string) — Request a planning pass before implementation
- `worker` `--worker=<worker>` (可選, enum, values=claude|codex|agy|auto) — Select an explicitly requested implementation worker
- `worker-target` `--worker-target=<provider>/<model>[:<effort>]` (可選, string) — Select an explicit provider, model, and effort target
- `cross-provider` `--cross-provider` (可選, boolean, default=false) — Allow the explicitly selected provider boundary
- `reasoner` `--reasoner=<provider>/<model>[:<effort>]` (可選, string) — Request a bounded second opinion
- `architect` `--architect` (可選, boolean) — Enable the architecture pass
- `no-architect` `--no-architect` (可選, boolean) — Disable the architecture pass

Legacy diagnostic（非主要語法）：
- `--codex` — Use an explicit worker, worker-target, or reasoner instead of the retired Codex shortcut

範例：
- `$flow-drive consolidate-remaining-dhpk-skill-families` — Implement a confirmed OpenSpec change

### `$flow-guide`

摘要：Guide routes, rules, next steps, closeout, and usage help
語法：`$flow-guide <help|route|rules|next|close> [--go] [<query>]`
呼叫類別：`implicit-eligible`
最高 authority：`delegate`

輸入：
- `action` `<help|route|rules|next|close>` (必要, enum, values=help|route|rules|next|close) — Choose one read-only guide action
- `query` `<query>` (可選, string) — Provide the action-specific skill or workflow text

Actions：
- `help` `$flow-guide help [<skill>]` — Show available Codex usage or one usage card
- `route` `$flow-guide route [--go] [<query>]` — Select the smallest workflow owner for a task
- `rules` `$flow-guide rules [<query>]` — Look up the governing workflow rules
- `next` `$flow-guide next [<query>]` — Identify the next bounded workflow action
- `close` `$flow-guide close [<query>]` — Check closeout evidence and remaining gates

選項：
- `go` `--go` (可選, boolean, default=false) — Request one bounded handoff when the route is eligible

範例：
- `$flow-guide help` — List the available Codex skill usage contracts

### `$git-smart-commit`

摘要：Group related changes into reviewable commits safely
語法：`$git-smart-commit [--scope=<path>] [--type=<type>] [--ai-co-author]`
呼叫類別：`explicit-only`
最高 authority：`git-write`

Actions：
- `group` `$git-smart-commit [--scope=<path>] [--type=<type>] [--ai-co-author]` — Analyze changes and produce grouped commit steps

選項：
- `scope` `--scope=<path>` (可選, string) — Limit status and diff collection
- `type` `--type=<type>` (可選, enum, values=feat|fix|docs|refactor|style|chore|test) — Force a conventional commit type
- `ai-co-author` `--ai-co-author` (可選, boolean, default=false) — Opt into the project-approved AI trailer

範例：
- `$git-smart-commit --scope=src/` — Use git smart commit with its declared interface

### `$git-worktree`

摘要：Manage native Git worktrees with confirmation boundaries
語法：`$git-worktree [<operation>] [--branch=<name>] [--base=<ref>]`
呼叫類別：`explicit-only`
最高 authority：`git-write`

輸入：
- `operation` `<operation>` (可選, enum, values=add|list|remove|prune, default=list) — Worktree operation

Actions：
- `manage` `$git-worktree [<operation>]` — Add, list, remove, or prune a worktree

選項：
- `branch` `--branch=<name>` (可選, string) — Branch used by add or remove
- `base` `--base=<ref>` (可選, string) — Base ref used when adding

範例：
- `$git-worktree list` — Use git worktree with its declared interface

### `$harness-audit`

摘要：Audit repository harness health with a deterministic scorecard
語法：`$harness-audit [<scope>] [--format=<format>] [--root=<path>]`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

輸入：
- `scope` `<scope>` (可選, enum, values=repo|hooks|skills|commands|agents, default=repo) — Harness area to inspect

Actions：
- `audit` `$harness-audit [<scope>]` — Run the deterministic harness audit

選項：
- `format` `--format=<format>` (可選, enum, values=text|json, default=text) — Output format
- `root` `--root=<path>` (可選, string) — Consumer repository root

範例：
- `$harness-audit skills --format=json` — Use harness audit with its declared interface

### `$harness-govern`

摘要：Govern harness health, budget, filling, revision, and sync
語法：`$harness-govern <health|budget|fill|revise|sync> [options]`
呼叫類別：`explicit-only`
最高 authority：`external-write`

輸入：
- `mode` `<health|budget|fill|revise|sync>` (必要, enum, values=health|budget|fill|revise|sync) — Choose one harness governance mode

Actions：
- `health` `$harness-govern health [options]` — Check harness structure and optionally fix safe issues
- `budget` `$harness-govern budget [options]` — Measure harness context cost and ranked savings
- `fill` `$harness-govern fill [options]` — Preview or apply missing harness layers
- `revise` `$harness-govern revise [options]` — Review and revise an active harness
- `sync` `$harness-govern sync [options]` — Plan or apply cross-platform harness synchronization

選項：
- `dir` `--dir=<path>` (可選, string) — Select the harness directory
- `dry-run` `--dry-run` (可選, boolean, default=false) — Preview changes without writing
- `fix-safe` `--fix-safe` (可選, boolean, default=false) — Apply only approved safe health fixes
- `fix` `--fix` (可選, boolean, default=false) — Apply the selected health fixes

範例：
- `$harness-govern health --dry-run` — Inspect harness health without changing files

### `$js-static-check-strategy`

摘要：Plan staged TypeScript checks and inspect strict-check progress
語法：`$js-static-check-strategy status [--path=<path>]`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

Actions：
- `status` `$js-static-check-strategy status [--path=<path>]` — Report the current static-check status

選項：
- `path` `--path=<path>` (可選, string) — Frontend root to scan

範例：
- `$js-static-check-strategy status --path=js/` — Use js static check strategy with its declared interface

### `$matrix-cell-onboard`

摘要：Plan and optionally apply one multi-major CI matrix cell
語法：`$matrix-cell-onboard <php-version> <laravel-version> [<phpunit>] [<monolog>]`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `php-version` `<php-version>` (必要, string) — PHP runtime version
- `laravel-version` `<laravel-version>` (必要, string) — Laravel version
- `phpunit` `<phpunit>` (可選, string) — PHPUnit version
- `monolog` `<monolog>` (可選, string) — Monolog version

Actions：
- `onboard` `$matrix-cell-onboard <php-version> <laravel-version>` — Plan and apply one matrix cell

範例：
- `$matrix-cell-onboard 8.3 12 11 3` — Use matrix cell onboard with its declared interface

### `$merge-prep`

摘要：Analyze a branch merge without mutating the repository
語法：`$merge-prep <source-branch> [--target=<branch>]`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

輸入：
- `source-branch` `<source-branch>` (必要, string) — Branch to analyze

Actions：
- `prepare` `$merge-prep <source-branch>` — Analyze merge conflicts and manual commands

選項：
- `target` `--target=<branch>` (可選, string) — Target branch for the analysis

範例：
- `$merge-prep feature/topic --target=main` — Use merge prep with its declared interface

### `$pr-summary`

摘要：Summarize open pull requests with evidence
語法：`$pr-summary [--author=<user>] [--label=<label>]`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

Actions：
- `summarize` `$pr-summary` — Group accessible open pull requests

選項：
- `author` `--author=<user>` (可選, string) — Filter by pull-request author
- `label` `--label=<label>` (可選, string) — Filter by pull-request label

範例：
- `$pr-summary --label=ready` — Use pr summary with its declared interface

### `$precommit`

摘要：Run the packaged deterministic pre-commit pipeline
語法：`$precommit [--fast]`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

Actions：
- `run` `$precommit [--fast]` — Run fast or full pre-commit stages

選項：
- `fast` `--fast` (可選, boolean, default=false) — Run the fast stage set

範例：
- `$precommit --fast` — Use precommit with its declared interface

### `$project-brief`

摘要：Convert one technical specification into an executive brief
語法：`$project-brief <tech-spec-path> [--output=<output-path>]`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `tech-spec-path` `<tech-spec-path>` (必要, string) — Readable technical specification

Actions：
- `brief` `$project-brief <tech-spec-path>` — Write an executive summary without changing the source

選項：
- `output` `--output=<output-path>` (可選, string) — Destination for the brief

範例：
- `$project-brief docs/spec.md --output=docs/brief.md` — Use project brief with its declared interface

### `$proposal-analyze`

摘要：Turn a proposal into an evidence-backed implementation roadmap
語法：`$proposal-analyze <proposal>`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `proposal` `<proposal>` (必要, string) — Proposal text or file path

Actions：
- `analyze` `$proposal-analyze <proposal>` — Research a proposal and produce a roadmap

範例：
- `$proposal-analyze openspec/changes/example/proposal.md` — Use proposal analyze with its declared interface

### `$release-creator`

摘要：Prepare or publish a validated release with a human gate
語法：`$release-creator <version> [--execute]`
呼叫類別：`explicit-only`
最高 authority：`external-write`

輸入：
- `version` `<version>` (必要, string) — Release version

Actions：
- `release` `$release-creator <version> [--execute]` — Prepare or publish one release

選項：
- `execute` `--execute` (可選, boolean, default=false) — Proceed past the human release gate

範例：
- `$release-creator 0.62.4 --execute` — Use release creator with its declared interface

### `$repo-verify`

摘要：Run runner-first repository verification with explicit evidence
語法：`$repo-verify [<mode>] [--integration=<path>] [--e2e=<path>]`
呼叫類別：`implicit-eligible`
最高 authority：`read-only`

輸入：
- `mode` `<mode>` (可選, enum, values=fast|full, default=full) — Verification depth

Actions：
- `verify` `$repo-verify [<mode>]` — Run fast or full repository verification

選項：
- `integration` `--integration=<path>` (可選, string) — Run the named integration stage
- `e2e` `--e2e=<path>` (可選, string) — Run the named end-to-end stage

範例：
- `$repo-verify fast` — Use repo verify with its declared interface

### `$review-pending`

摘要：Delegate a read-only pending-change review
語法：`$review-pending [--files=<rel-paths>]`
呼叫類別：`implicit-eligible`
最高 authority：`delegate`

Actions：
- `review` `$review-pending` — Delegate the selected pending files to code-reviewer

選項：
- `files` `--files=<rel-paths>` (可選, string) — Comma-separated relative file paths

範例：
- `$review-pending --files=src/a.js` — Use review pending with its declared interface

### `$skill-scope`

摘要：Route skill governance to one focused mode with evidence
語法：`$skill-scope <health|judge|stocktake|scout>`
呼叫類別：`implicit-eligible`
最高 authority：`delegate`

輸入：
- `mode` `<health|judge|stocktake|scout>` (必要, enum, values=health|judge|stocktake|scout) — Choose one skill governance mode
- `target` `<target>` (可選, string) — Select the skill or capability to inspect

Actions：
- `health` `$skill-scope health <skill>` — Check one skill or package structure
- `judge` `$skill-scope judge <skill>` — Score one skill or package quality
- `stocktake` `$skill-scope stocktake` — Audit installed consumer skills and commands
- `scout` `$skill-scope scout <capability>` — Search for an existing skill or capability

範例：
- `$skill-scope health flow-guide` — Run a focused health check for one skill

### `$spec-mine`

摘要：Extract one capability baseline into an OpenSpec behavioral spec
語法：`$spec-mine [<capability-or-path>]`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `capability-or-path` `<capability-or-path>` (可選, string) — Capability or path to mine first

Actions：
- `mine` `$spec-mine [<capability-or-path>]` — Write one bounded behavioral baseline

範例：
- `$spec-mine billing` — Use spec mine with its declared interface

### `$tdd-workflow`

摘要：Drive behavior-first tests through a minimal red-green loop
語法：`$tdd-workflow [test-generation] <task>`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `mode` `<test-generation>` (可選, enum, values=test-generation) — Optionally request test scaffold generation
- `task` `<task>` (必要, string) — Describe the behavior-first development task

Actions：
- `tdd` `$tdd-workflow <task>` — Guide a behavior-first test and implementation loop
- `test-generation` `$tdd-workflow test-generation <target>` — Generate a focused failing-test scaffold

範例：
- `$tdd-workflow test-generation tests/OrderTest.php` — Use tdd with its declared interface

### `$update-codemaps`

摘要：Refresh architecture codemaps from the live project structure
語法：`$update-codemaps`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

Actions：
- `update` `$update-codemaps` — Refresh the bounded architecture codemaps

範例：
- `$update-codemaps` — Use update codemaps with its declared interface

### `$update-docs`

摘要：Update a bounded user or agent document from live evidence
語法：`$update-docs <docs-path-or-workflow-keyword>`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `target` `<docs-path-or-workflow-keyword>` (必要, string) — Documentation path or workflow keyword

Actions：
- `update` `$update-docs <docs-path-or-workflow-keyword>` — Update owned documentation and its locale pair

範例：
- `$update-docs docs/configuration.md` — Use update docs with its declared interface
