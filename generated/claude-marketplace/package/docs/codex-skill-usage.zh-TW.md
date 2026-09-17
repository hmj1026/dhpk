# Codex 技能使用發現

<!-- GENERATED: inventory-owned Usage Grammar. Do not edit manually. -->

來源 inventory revision：`sha256:4870c6b34e8040a8dde5267d2b13e1f00f23fe44258b546900c23303a5d8300e`。使用 `$flow-guide help` 取得唯讀、逐步揭露的參數卡。

## 可用技能

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

### `$dhpk-git-smart-commit`

摘要：Group related changes into reviewable commits safely
語法：`$dhpk-git-smart-commit`
呼叫類別：`explicit-only`
最高 authority：`git-write`

Actions：
- `group` `$dhpk-git-smart-commit` — Analyze changes and produce grouped commit steps

範例：
- `$dhpk-git-smart-commit split these changes into logical commits` — Prepare a safe grouped commit plan

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

### `$dhpk-tdd-workflow`

摘要：Drive behavior-first tests through a minimal red-green loop
語法：`$dhpk-tdd-workflow [test-generation] <task>`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `mode` `<test-generation>` (可選, enum, values=test-generation) — Optionally request test scaffold generation
- `task` `<task>` (必要, string) — Describe the behavior-first development task

Actions：
- `tdd` `$dhpk-tdd-workflow <task>` — Guide a behavior-first test and implementation loop
- `test-generation` `$dhpk-tdd-workflow test-generation <target>` — Generate a focused failing-test scaffold

範例：
- `$dhpk-tdd-workflow test-generation tests/OrderTest.php` — Start with a behavior-focused test scaffold

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
