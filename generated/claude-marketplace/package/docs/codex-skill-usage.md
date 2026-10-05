# Codex skill usage discovery

<!-- GENERATED: inventory-owned Usage Grammar. Do not edit manually. -->

Source inventory revision: `sha256:29f4f17a762546323713f155967193b5cd6e8366e8bddd522e66faca75a905f5`. Use `$flow-guide help` for read-only progressive usage cards.

## Available skills

### `$change-verdict`

Summary: Return an evidence-backed read-only change verdict
Syntax: `$change-verdict [--mode=<mode>] [--coverage] [<target>]`
Invocation class: `implicit-eligible`
Maximum authority: `read-only`

Inputs:
- `target` `<target>` (optional, string) — Change, PR, test, document, or risk target

Actions:
- `code` `$change-verdict --mode=code [<target>]` — Judge code changes
- `pr` `$change-verdict --mode=pr [<target>]` — Judge pull-request evidence
- `security` `$change-verdict --mode=security [<target>]` — Judge security evidence
- `tests` `$change-verdict --mode=tests [--coverage] [<target>]` — Judge test and coverage evidence
- `docs` `$change-verdict --mode=docs [<target>]` — Judge documentation evidence
- `risk` `$change-verdict --mode=risk [<target>]` — Judge change-risk evidence

Options:
- `mode` `--mode=<mode>` (optional, enum, values=code|pr|security|tests|docs|risk) — Select one verdict mode
- `coverage` `--coverage` (optional, boolean, default=false) — Include coverage evidence in tests mode

Examples:
- `$change-verdict --mode=tests --coverage` — Use change verdict with its declared interface

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

### `$flow-drive`

Summary: Implement a confirmed specification with bounded evidence
Syntax: `$flow-drive <confirmed-spec-or-change-id> [--plan[=<model>:<effort>]] [--plan-mode=auto|bounded|discovery] [--worker=<worker>] [--worker-target=<provider>/<model>[:<effort>]] [--cross-provider] [--reasoner=<provider>/<model>[:<effort>]] [--architect|--no-architect]`
Invocation class: `explicit-only`
Maximum authority: `workspace-write`

Inputs:
- `confirmed-spec-or-change-id` `<confirmed-spec-or-change-id>` (required, string) — Select the confirmed specification or change

Actions:
- `apply` `$flow-drive <confirmed-spec-or-change-id>` — Implement the confirmed specification or OpenSpec change

Options:
- `plan` `--plan[=<model>:<effort>]` (optional, string) — Request a planning pass before implementation
- `plan-mode` `--plan-mode=auto|bounded|discovery` (optional, enum, values=auto|bounded|discovery, default=auto) — Select the consult scope; requires --plan and defaults to auto when enabled
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

### `$ui-ux-verify`

Summary: Audit one rendered page against one UI specification
Syntax: `$ui-ux-verify [<url>] [spec:<spec-path>]`
Invocation class: `implicit-eligible`
Maximum authority: `workspace-write`

Inputs:
- `url` `<url>` (optional, string) — Page URL
- `spec-path` `<spec-path>` (optional, string) — OpenSpec UI specification

Actions:
- `verify` `$ui-ux-verify [<url>] [spec:<spec-path>]` — Capture and report one read-only UI audit

Examples:
- `$ui-ux-verify spec:openspec/changes/example/spec.md` — Use ui ux verify with its declared interface

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
