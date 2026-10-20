# Codex 技能使用發現

<!-- GENERATED: inventory-owned Usage Grammar. Do not edit manually. -->

來源 inventory revision：`sha256:b42ffd92ab377ef9046dcb46a45267bd80a4d7d9b4d72e4c836047e689584111`。使用 `$flow-guide help` 取得唯讀、逐步揭露的參數卡。

## 可用技能

### `$change-verdict`

摘要：Review changes or audit dependencies with bounded explicit fixes
語法：`$change-verdict [--mode=<mode>] [<target>] | pending [--files=<paths>] | deps [fix] [--level=<severity>]`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `target` `<target>` (可選, string) — Change, PR, test, document, or risk target

Actions：
- `code` `$change-verdict --mode=code [<target>]` — Judge code changes
- `pr` `$change-verdict --mode=pr [<target>]` — Judge pull-request evidence
- `security` `$change-verdict --mode=security [<target>]` — Judge security evidence
- `tests` `$change-verdict --mode=tests [--coverage] [<target>]` — Judge test and coverage evidence
- `docs` `$change-verdict --mode=docs [<target>]` — Judge documentation evidence
- `risk` `$change-verdict --mode=risk [<target>]` — Judge change-risk evidence
- `pending` `$change-verdict pending [--files=<paths>]` — Delegate a read-only pending-change review
- `deps` `$change-verdict deps [--level=<severity>]` — Audit dependency risks without mutation
- `deps-fix` `$change-verdict deps fix [--level=<severity>]` — Delegate requested bounded dependency remediation then obtain an independent verdict

選項：
- `mode` `--mode=<mode>` (可選, enum, values=code|pr|security|tests|docs|risk) — Select one verdict mode
- `coverage` `--coverage` (可選, boolean, default=false) — Include coverage evidence in tests mode
- `files` `--files=<paths>` (可選, string) — Comma-separated relative pending paths
- `level` `--level=<severity>` (可選, enum, values=low|moderate|high|critical, default=moderate) — Minimum vulnerability severity
- `fix` `--fix` (可選, boolean, default=false) — Explicitly request bounded dependency remediation

範例：
- `$change-verdict --mode=tests --coverage` — Use change verdict with its declared interface
- `$change-verdict pending --files=src/a.js` — Delegate pending review
- `$change-verdict deps --level=high` — Audit dependencies without mutation
- `$change-verdict deps fix` — Request bounded dependency remediation

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

### `$doc-maintain`

摘要：Mode-specific doc-maintain workflows
語法：`$doc-maintain <task | mode> <target>`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `task` `<task | mode>` (必要, string) — Natural-language task or explicit mode

Actions：
- `update` `$doc-maintain update <target>` — update workflow
- `codemap` `$doc-maintain codemap <target>` — codemap workflow
- `refactor` `$doc-maintain refactor <target>` — refactor workflow

範例：
- `$doc-maintain update docs/guide.md` — Run the selected mode

### `$flow-drive`

摘要：Execute one scoped task with diagnosis and acceptance evidence
語法：`$flow-drive <task-text|task-file|confirmed-spec-or-change-id> [--worker=auto|provider[/model[:effort]]] [--reasoner=provider[/model[:effort]]] [--cross] [--plan[=auto|bounded|discovery]] [--architect|--no-architect]`
呼叫類別：`explicit-only`
最高 authority：`workspace-write`

輸入：
- `task-input` `<task-text|task-file|confirmed-spec-or-change-id>` (必要, string) — Provide one task text argument, task file path, or confirmed specification/change ID; quote text and paths containing spaces

Actions：
- `apply` `$flow-drive <task-text|task-file|confirmed-spec-or-change-id>` — Resolve task text, a file or confirmed ID; diagnose prerequisites, implement assigned items and verify acceptance

選項：
- `plan` `--plan[=auto|bounded|discovery]` (可選, enum, values=auto|bounded|discovery) — Request a planner scope using the current Host declared effective target
- `worker` `--worker=auto|provider[/model[:effort]]` (可選, string, default=auto) — Select automatic native candidates, one Provider, or an exact Worker target; external intent still requires a current Host grant
- `cross` `--cross` (可選, boolean, default=false) — Expand automatic candidates for this invocation only; obtain grants before selected external probes or launches
- `reasoner` `--reasoner=<provider>[/<model>[:<effort>]]` (可選, string) — Request a read-only reasoner whose verified READY_FOR_DISPATCH conclusion gates dependent writers
- `architect` `--architect` (可選, boolean) — Request consultation; report UNAVAILABLE when the current Host has no supported architecture route
- `no-architect` `--no-architect` (可選, boolean) — Suppress an optional consult while preserving required Host gates

Legacy diagnostic（非主要語法）：
- `--codex` — Use an explicit worker or reasoner instead of the retired Codex shortcut

範例：
- `$flow-drive "Fix the receipt total and verify it matches the receipt lines."` — Resolve and implement a bounded task with explicit acceptance
- `$flow-drive "Diagnose the display symptom, repair the receipt total, and draft an assigned manual proposal." --cross` — Request additional Provider candidates under the selected interface authorization contract; unknown cause gates only dependent writes

### `$flow-guide`

摘要：Guide routes, rules, next steps, closeout, and usage help
語法：`$flow-guide <help|route|rules|next|close> [--go] [--host <host>] [<query>]`
呼叫類別：`implicit-eligible`
最高 authority：`delegate`

輸入：
- `action` `<help|route|rules|next|close>` (必要, enum, values=help|route|rules|next|close) — Choose one read-only guide action
- `query` `<query>` (可選, string) — Provide the action-specific skill or workflow text

Actions：
- `help` `$flow-guide help [<skill>]` — Show available Codex usage or one usage card
- `route` `$flow-guide route [--go] [<query>]` — Select the smallest workflow owner for a task
- `rules` `$flow-guide rules [<query>]` — Look up the governing workflow rules
- `next` `$flow-guide next [--host <host>] [<query>]` — Identify the next bounded workflow action
- `close` `$flow-guide close [<query>]` — Check closeout evidence and remaining gates

選項：
- `go` `--go` (可選, boolean, default=false) — Request one bounded handoff when the route is eligible
- `host` `--host` (可選, enum, values=claude-code|codex-cli|agy|cursor|claude|codex, default=claude-code) — Select next-action invocation formatting and handoff Host; Codex passes codex-cli

範例：
- `$flow-guide help` — List the available Codex skill usage contracts
- `$flow-guide next --host codex-cli` — Resolve declared next steps using Codex invocation formatting

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

### `$ui-ux-verify`

摘要：Audit one rendered page against one UI specification
語法：`$ui-ux-verify [<url>] [spec:<spec-path>]`
呼叫類別：`implicit-eligible`
最高 authority：`workspace-write`

輸入：
- `url` `<url>` (可選, string) — Page URL
- `spec-path` `<spec-path>` (可選, string) — OpenSpec UI specification

Actions：
- `verify` `$ui-ux-verify [<url>] [spec:<spec-path>]` — Capture and report one read-only UI audit

範例：
- `$ui-ux-verify spec:openspec/changes/example/spec.md` — Use ui ux verify with its declared interface
