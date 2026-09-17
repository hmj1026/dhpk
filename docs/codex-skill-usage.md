# Codex skill usage discovery

<!-- GENERATED: inventory-owned Usage Grammar. Do not edit manually. -->

Source inventory revision: `sha256:4870c6b34e8040a8dde5267d2b13e1f00f23fe44258b546900c23303a5d8300e`. Use `$flow-guide help` for read-only progressive usage cards.

## Available skills

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

### `$dhpk-git-smart-commit`

Summary: Group related changes into reviewable commits safely
Syntax: `$dhpk-git-smart-commit`
Invocation class: `explicit-only`
Maximum authority: `git-write`

Actions:
- `group` `$dhpk-git-smart-commit` — Analyze changes and produce grouped commit steps

Examples:
- `$dhpk-git-smart-commit split these changes into logical commits` — Prepare a safe grouped commit plan

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

### `$dhpk-tdd-workflow`

Summary: Drive behavior-first tests through a minimal red-green loop
Syntax: `$dhpk-tdd-workflow [test-generation] <task>`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `mode` `<test-generation>` (optional, enum, values=test-generation) — Optionally request test scaffold generation
- `task` `<task>` (required, string) — Describe the behavior-first development task

Actions:
- `tdd` `$dhpk-tdd-workflow <task>` — Guide a behavior-first test and implementation loop
- `test-generation` `$dhpk-tdd-workflow test-generation <target>` — Generate a focused failing-test scaffold

Examples:
- `$dhpk-tdd-workflow test-generation tests/OrderTest.php` — Start with a behavior-focused test scaffold

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
