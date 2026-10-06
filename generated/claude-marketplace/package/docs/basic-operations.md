# Basic Operations

> **Languages**: **English** · [繁體中文](./basic-operations.zh-TW.md)

## Acceptance applicability

Installed structure and selected lifecycle checks are the default acceptance
boundary. A command or CLI being present does not prove native runtime
execution; native checks are triggered by an affected integration, activation
defect, or explicit request. Preserve `NOT_RUN`, `UNAVAILABLE`, and `BLOCKED`
states in operational records.

This page walks through the operational lifecycle of dhpk: installing it, the day-to-day command flow, the automatic review cycle, and how to migrate an existing project onto it. For exact Codex/Cursor installation, status, and rollback instructions, use the [platform installation SSOT](./platform-installation.md). For the full `userConfig` knob reference, see [`docs/configuration.md`](./configuration.md).

## Decision ladder

The `common` collection in `manifests/install-profiles.json` is the sole main
installation default. Current Host routes, support status, and receipt handling
are documented in the [platform installation SSOT](./platform-installation.md).
Static package evidence is not runtime evidence: report `NOT_RUN`, `BLOCKED`, or
`UNAVAILABLE` until the corresponding consumer is observed.

Use this order for a fresh request: **inspect** the repository and session
state → **verify** the installed surface → **choose** Claude, supported Codex
sync, or the experimental native Codex surface → **route** through Claude
`/dhpk:flow-guide` for classification, `/dhpk:flow-drive` for execution, the
Cursor generated command, or Codex `$flow-guide` / `$flow-drive` (Codex has no
`/dhpk:*` command) or an explicit family skill → **implement** with TDD and pre-edit
impact checks →
**review/verify** the resulting evidence → **handoff** with exactly one next
command. Plugin management (`claude plugin …`, `codex plugin …`) does not invoke
a skill.

The behavior owners are [`rules/execution-policy.md`](../rules/execution-policy.md),
[`docs/configuration.md`](./configuration.md),
[`docs/skill-platform-migration.md`](./skill-platform-migration.md),
[`docs/distribution-surfaces.md`](./distribution-surfaces.md), the
[`distribution-inventory.json`](../manifests/distribution-inventory.json)
manifest, [`scripts/install.sh`](../scripts/install.sh), the supported
[`install-codex-skills.sh`](../scripts/hooks/install-codex-skills.sh), and the
supported [`install-cursor-harness.sh`](../scripts/hooks/install-cursor-harness.sh). OpenSpec
change proposals, specifications, and task evidence live under
`openspec/changes/`; a passing validator is not version-control delivery.

If you want a one-page reference that tells you which skill/command to use first,
also use: [技能與 Slash Command 快速速查（非專業版）](./skill-command-cheat-sheet.zh-TW.md).

When a destination is unclear and the work will span sessions, first record a
wayfinder checkpoint with destination candidates, current frontier, and one
next decision. A clear single-session request goes directly to its route.

## Distribution surface policy

dhpk deliberately exposes several surfaces with different support tiers:

| Surface | Tier | Meaning |
|---|---|---|
| Claude marketplace | Supported | Primary consumer install and update path. |
| `claude --plugin-dir` | Development-only | Working-tree iteration; not a release channel. |
| `scripts/install.sh` | Convenience wrapper | Runs the Claude install contract; it is not a separate distribution. |
| `install-codex-skills.sh` | Supported | Stable, canonical Codex project sync path; runtime activation is mutually exclusive with the native `dhpk@dhpk` plugin. |
| `install-cursor-harness.sh` | Supported | Stable Cursor project-local sync path (`.cursor/`). |
| Codex plugin marketplace | Experimental | Physical publication package for isolated disposable `CODEX_HOME` experiments; runtime activation is mutually exclusive with project-local sync and the tier stays Experimental until a separate graduation decision. |
| OpenAI Public Plugin Directory | Submission candidate (`NOT_PUBLISHED`) | Intended daily-use route for Codex and ChatGPT Work after platform approval and publication; local/repository marketplaces are development/testing sources. |
| Antigravity / AGY sync | Adapter/package | Antigravity project skills use `.agents/skills` mapping while rules/workflows remain under `.agent`; AGY uses its native plugin package and validator. |

The OpenAI Public Plugin is not yet available in the public directory. Until it
is published, use the existing supported and compatibility procedures below
only where they currently apply. The public directory becomes the target
daily-use route after publication; no one-time legacy-installation cutover
executor has shipped. The current native Codex marketplace route is a separate
experimental package, and a local repository marketplace does not publish the
OpenAI listing. See the [submission preparation SSOT](./openai-submission.md).

Plugin management commands (`claude plugin …`, `codex plugin …`) are separate
from skill invocation. Choose one Codex runtime route per host: use the
supported project-local `codex-sync` path for daily work, or use the
experimental native package only in a disposable isolated `CODEX_HOME`.
Claude workflows enter through `/dhpk:flow-guide`,
`/dhpk:flow-drive`, or an explicit family skill; Cursor uses the generated
command after `install-cursor-harness.sh`; Codex enters through `$flow-guide` /
`$flow-drive` after project-local `.codex/` sync (Codex has no `/dhpk:*` command).

## Install

dhpk follows the standard [Claude Code plugin distribution model](https://docs.claude.com/en/docs/claude-code/plugins): the same marketplace + manifest is reachable from **two surfaces**, pick whichever fits your workflow:

- **Terminal** — `claude plugin marketplace add …` / `claude plugin install …`
- **Inside a Claude Code session** — `/plugin marketplace add …` / `/plugin install …` (or the interactive `/plugin` browser)

Both surfaces read the same `.claude-plugin/marketplace.json` shipped in this repo, so the result is identical.

### Path A — From GitHub (recommended)

No clone needed. Fastest path for end users.

The GitHub marketplace uses the selected common default collection. Current
Claude install, update, migration, receipt, and collision procedures are owned
by the [platform installation SSOT](./platform-installation.md).

```bash
# Terminal
claude plugin marketplace add hmj1026/dhpk
claude plugin install dhpk@dhpk
```

```text
# …or inside Claude Code
/plugin marketplace add hmj1026/dhpk
/plugin install dhpk@dhpk
```

Add `--config` flags to pre-seed config (skip if you'd rather answer interactively via `/dhpk:setup` after install) — see [`docs/configuration.md`](./configuration.md) for the full knob reference:

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-8.x,laravel-11,phpunit-11,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

Pin a specific release by appending a version: `claude plugin install dhpk@dhpk@v0.6.0`. Available stacks/versions live in `manifests/module-catalog.json` (SSOT); curated module presets are in `manifests/install-profiles.json`. Docker prerequisites: see [`docs/docker-setup.md`](./docker-setup.md).

After install, reconfigure any time from inside Claude Code:

```text
/dhpk:setup           # rerun the same questions
/dhpk:setup --show    # print current effective config
```

### Path B — Local clone + interactive installer

Use this for an out-of-Claude shell wizard or when hacking on the plugin source.
It is a convenience/development path, not a second release channel. **You must
`git clone` first** — the installer lives inside the repo.

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude plugin marketplace add ~/projects/dhpk
bash ~/projects/dhpk/scripts/install.sh        # interactive (gum / python3 fallback)
```

With no stack modules selected, the installer uses the selected common default
collection. The [platform installation SSOT](./platform-installation.md) owns
the current Host install/update/uninstall commands and receipt behavior; this
guide keeps the local-clone route as a development entry point.

Validate the local checkout with the source gates:

```bash
node scripts/ci/validate-plugin.js
node scripts/ci/validate-skills.js --strict
```

These commands validate repository source and are not proof of the official
consumer. The Claude marketplace points at the generated physical package
under `generated/claude-marketplace/package`; it excludes the development-only
root `CLAUDE.md` before the package enters the marketplace cache. Verify that
projection is current with:

```bash
node scripts/ci/gen-claude-marketplace-package.js --check
```

When the Claude CLI is available and `claude plugin list --json` reports an
`installPath`, retain both the staged-package check and the installed-cache
command `claude plugin validate <installed>/.claude-plugin/plugin.json --strict`
as official evidence. A non-zero result is blocking. If the CLI omits
`installPath`, the consumer gate records installed-cache validation as `NOT
RUN`, returns `FAIL`, and blocks completion; no official PASS may be claimed.
When the CLI is unavailable, record `NOT RUN` and do not claim an official
PASS.

For live source edits during plugin development (no reinstall loop), see [§ Development](#development).

### Update / Uninstall

```bash
# User-scoped install (the CLI default)
claude plugin update -y dhpk@dhpk
# Project-scoped install
claude plugin update --scope project -y dhpk@dhpk
claude plugin uninstall dhpk@dhpk      # remove the plugin
claude plugin marketplace remove dhpk  # forget the marketplace entry
```

Use the same scope that was used to install the plugin. The update command
defaults to the user scope, so a project-scoped install requires
`--scope project`; `-y`/`--yes` avoids the confirmation prompt in non-TTY or CI
environments.

The same actions are available as `/plugin update dhpk@dhpk`, `/plugin uninstall dhpk@dhpk`, `/plugin marketplace remove dhpk` inside Claude Code.

For a project that uses the supported Codex projection, update Claude first and
then refresh the project-local files:

`CLAUDE_PLUGIN_ROOT` is exported inside the Claude Code plugin runtime (hooks,
commands, and Bash tools launched from that session); an ordinary terminal does
not receive it automatically. From a normal shell, point at a persistent local
checkout instead, for example `DHPK_ROOT=/absolute/path/to/dhpk` and run
`bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" ...`. Do not hard-code
an ephemeral marketplace cache path.

```bash
claude plugin update -y dhpk@dhpk
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" --update
```

If the project has a pre-consolidation Codex receipt or unprefixed dhpk skill
directories, migrate ownership explicitly before the normal update:

```bash
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" --migrate --update
```

`--migrate` adopts only unchanged destinations whose legacy source matches
exactly. User-owned, edited, retargeted, malformed, and ambiguous entries are
preserved and reported. `--force` only bypasses the project-root heuristic; it
never overrides ownership, collision, symlink, containment, or modified-file
safety. Use `--uninstall` to remove only unchanged receipt-owned entries. See
the complete rename/merge and rollback guide in
[`skill-platform-migration.md`](./skill-platform-migration.md).

To remove both surfaces, reverse the installation order: first run the Codex
projection script with `--uninstall` in every project while the plugin root is
still available, then run `claude plugin uninstall dhpk@dhpk`, and finally
remove the marketplace entry if desired. This avoids broken project symlinks
and is also the safe order for copy mode.

### Install troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `marketplace add` says the path doesn't exist | You followed Path B but skipped the `git clone` step | Run `git clone https://github.com/hmj1026/dhpk ~/projects/dhpk` first — or switch to Path A which needs no clone |
| `claude plugin install dhpk@dhpk` says marketplace not found | `marketplace add` didn't run, or you removed it earlier | Re-run the `marketplace add` line from your chosen path |
| `/dhpk:*` commands or hooks don't appear after install | Session loaded its skill list before install finished | Run `/reload-plugins` inside Claude Code, or restart the session |
| `claude plugin list` shows dhpk but `/dhpk:setup` is missing | Plugin is installed but disabled | `claude plugin enable dhpk@dhpk` (or `/plugin enable dhpk@dhpk`) |
| `install.sh` errors on `gum` / `jq` not found | Optional UI deps missing | The script falls back to plain shell / `python3`; install `gum` and `jq` for the nicer flow, or ignore the warning |
| Some skill descriptions truncated/dropped (seen in `/doctor`) | Many modules shipped → skill-listing budget overflow (module skills list regardless of `modules`, [#12](https://github.com/hmj1026/dhpk/issues/12)) | Raise `skillListingBudgetFraction` in `settings.json` (default ~1% → `0.02`–`0.03`), or install fewer modules / disable the whole plugin with `/plugin` where unused |
| Version advisory asks you to update `.claude/dhpk-versions.json`, but it is a symlink | The Write tool refuses symlink targets | Run `realpath .claude/dhpk-versions.json` and write the verified entry to that real path; `scripts/version-diff.sh` prints the same safe instruction |

## Common workflows

dhpk provides a single safe front door and structured delivery exits for daily development:

```text
inspect → verify surface → route → plan/classify → implement → review → verify → handoff
```

When you know the outcome but haven't decided which capability to dispatch, Claude uses `/dhpk:flow-guide`, Codex uses `$flow-guide`, and Cursor uses its local commands. When the exact workflow is known, invoke the specific project skill or slash command directly.

For a fast lookup, see the cheat sheet: [Skill and Slash Command Cheat Sheet](./skill-command-cheat-sheet.md) · [繁體中文](./skill-command-cheat-sheet.zh-TW.md).

### Standard 5-Step Development Workflow

Follow this 5-step standard cadence for day-to-day work, where each step defines clear inputs, execution commands, and explicit completion criteria:

#### Step 1: Verify Environment & Active Modules

- **Actions**:
  - Run `/dhpk:flow-guide help` (Codex: `$flow-guide help`) to list all registered skills and commands.
  - Run `/dhpk:setup --show` to inspect currently active stack modules (PHP, Laravel, JS, Python, etc.) and hook configurations.
- **Completion Criterion**: Active modules and configuration match project requirements without missing prerequisites.

#### Step 2: Inquire, Explore & Route

- **Actions**:
  - **Workflow Consultation**: Ask the guide directly instead of guessing commands:
    ```text
    /dhpk:flow-guide route implement user password reset email notification
    /dhpk:flow-guide route investigate user login captcha timeout issue
    ```
    Adding `--go` (e.g., `/dhpk:flow-guide route --go <task>`) triggers a single bounded handoff if the matched target is `implicit-eligible`; `explicit-only` targets report exact command syntax without executing.
  - **Code Exploration & Root-Cause Diagnosis**: For unfamiliar modules, history investigations, or regressions, use read-only inspection:
    ```text
    /dhpk:code-trace --mode explore <module-or-class>      # inspect symbols, callers, and structure
    /dhpk:code-trace --mode diagnose <error-or-symptom>   # gather falsifiable root-cause evidence
    /dhpk:code-trace --mode history <function-or-file>    # trace Git timeline and breaking changes
    ```
- **Completion Criterion**: Clear ownership boundary identified or a single falsifiable root cause supported by evidence; no code is modified in this step.

#### Step 3: Implement Confirmed Work with TDD

- **Actions**:
  - Once requirements, acceptance criteria, or OpenSpec changes are confirmed, invoke the implementation front door:
    ```text
    /dhpk:flow-drive <confirmed-spec-or-change-id>
    ```
  - **Test-Driven Development (TDD)**: Use `tdd-workflow` (or the `tdd-guide` subagent) to drive RED → GREEN → REFACTOR. Write failing observable tests first (RED), implement minimal code to pass (GREEN), then refactor.
- **Implementation & Dispatch Policy (Co-located Rules)**:
  - **Pre-Implementation Decision State**: Every task must begin with an explicit state label: `CLEAR`, `REASONER_REQUIRED`, `HUMAN_REQUIRED`, or `BLOCKED`. Domain boundary questions consult `architect`; unresolved uncertainty requires a read-only Reasoner before any Writer runs.
  - **OpenSpec Lifecycle**: Cross-session or complex initiatives author `openspec/changes/<id>/` artifacts via `/opsx:new`. Completion requires all task checkboxes, verification gates, and review obligations resolved before archiving; passing tests or approved plans alone are not archival clearance.
  - **Planner Consult Scope**: `--plan` supports `--plan-mode=bounded` (max 4 direct reads, 0 child agent) or `--plan-mode=discovery` (up to 12 reads, 2 child agents). Defaults to `auto` (chooses bounded when evidence is clear and no Material Risk Signal applies).
  - **Worker Dispatch**: When `orchestration_dispatch=on` (default), changes up to 2 files stay inline; larger mechanical batches designate `--worker=<claude|codex|agy>`.
  - **Codex CLI Integration**: dhpk is Codex-free by default. Use `--worker=codex` for CLI mechanical execution, `--reasoner=codex-cli/<model>[:<effort>]` for independent reasoning passes, or `--second-opinion=codex-exec` for single blind reviews. Missing binaries report unavailable optional backends without bypassing security gates.
- **Completion Criterion**: All changes carry focused verification and all-green test evidence; no unexplained skipped checks remain.

#### Step 4: Review, Audit & Quality Gates

- **Actions**:
  - **Advisory Specialist Review**: Dispatch matching reviewers based on modified file extensions and paths:
    ```text
    /dhpk:review-pending                              # review all currently modified files
    /dhpk:review-pending --files="app/Models/User.php" # review designated file subset
    ```
  - **Standalone Quality Verdicts**: Evaluate code standards, security vulnerabilities, test adequacy, or change risk:
    ```text
    /dhpk:change-verdict --mode code                  # code quality and specification conformance
    /dhpk:change-verdict --mode security              # OWASP security and secrets audit
    /dhpk:change-verdict --mode tests --ac-trace      # acceptance criteria traced to test results
    /dhpk:change-verdict --mode risk                  # blast radius and breaking change risk
    ```
  - **Pre-Commit Verification Pipelines**:
    ```text
    /dhpk:precommit --fast                            # fast local pipeline (lint + unit tests)
    /dhpk:precommit                                   # full pipeline (lint:fix -> build -> test:unit)
    /dhpk:verify                                      # cross-layer validation (includes integration & e2e)
    ```
- **Delivery Sequence & Handoff Policy**:
  - CRITICAL findings must be remediated prior to delivery.
  - Delivery sequence is strictly: all tasks and gates pass → archive/sync OpenSpec → add changelog fragment → open Draft PR targeting `develop` → monitor CI via `gh run watch` to completed conclusion → human merge gate.
  - Handoff reports must record explicit states: `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, or `UNAVAILABLE`.
- **Completion Criterion**: Zero CRITICAL blockers, precommit all-green, and all gate verdicts backed by fresh evidence.

#### Step 5: Atomic Commit, PR & Release

- **Actions**:
  - **Smart Batch Commit**: Group changes by cohesion into Conventional Commit messages and runnable Git commands:
    ```text
    /dhpk:smart-commit
    /dhpk:smart-commit --scope resources/assets/js --type refactor
    ```
  - **Open Pull Request**: Extract ticket IDs and generate project-compliant PR summaries:
    ```text
    /dhpk:create-pr                                   # preview gh pr create command (--dry-run default)
    /dhpk:create-pr --execute                         # create PR targeting develop branch
    ```
  - **Release & Deployment Checklist**:
    ```text
    /dhpk:create-release                              # version bump, changelog update, and Git tag
    dhpk-deploy-list --tag="[RELEASE-1.0.0]" --description="Release summary" --lang=en
    ```
- **Completion Criterion**: Working tree clean, PR opened, and remote CI checks pass green.

### Standalone Assistance Workflows

Outside the primary delivery flow, specialized agents can be invoked directly:
- **E2E Testing Workflow**: `/dhpk:flow-guide route write E2E tests` routes to `e2e-runner` to author specs, helpers, fixtures, and journey artifacts. Application defects yield a worker-ready fix specification.
- **Documentation Updates**: Structural changes route to `doc-updater` to synchronize codemaps and user documentation against fresh evidence.
- **OpenSpec Long Apply Save & Resume**: Use `/dhpk:opsx-apply-resume [<change-id>]` to snapshot working state before token exhaustion and resume execution in a fresh session.<a id="6-unattended-openspec-session-large-uncertainty-on-ramp"></a>

---

### Detailed Parameter Reference & Examples for Core Workflow Skills

The following sections provide comprehensive parameter references, types, default values, boundary limits, and practical examples for each core skill in the 5-step standard workflow:

#### 1. flow-guide (Workflow Consultation, Routing & Policy Guidance)

- **Purpose**: Read-only workflow consultant and routing hub. Handles navigation, policy queries, readiness verification, and bounded handoffs. Never mutates workspace code or invokes explicit-only commands.
- **Invocation Syntax**: `/dhpk:flow-guide <action> [--go] [<query>]` (Codex: `$flow-guide <action> [--go] [<query>]`)
- **Parameter Breakdown**:

  | Parameter | Type / Choices | Required | Description |
  |---|---|---|---|
  | `<action>` | `help` \| `route` \| `rules` \| `next` \| `close` | Yes | The single action to execute. |
  | `help` | Subcommand | — | Query the skill catalog; when given a skill name (e.g., `help flow-drive`), prints a single metadata usage card. |
  | `route` | Subcommand | — | Match natural language intent to the best skill or workflow. |
  | `rules` | Subcommand | — | Retrieve policy pointers, pre-plan checklists, or phase delivery criteria. |
  | `next` | Subcommand | — | Recommend the next action based on current workspace, Git branch, and status. |
  | `close` | Subcommand | — | Closeout gate check: inspect changed files, test evidence, review obligations, and open risks. |
  | `[--go]` | Boolean flag | No | Valid only with `route`. If the matched target is implicit-eligible, executes a single bounded handoff; if explicit-only, outputs the exact command syntax without executing. |
  | `[query]` | String | No | Free-text task description, error symptom, or skill name. |

- **Practical Examples**:
  ```text
  # View parameter usage card for a specific skill
  /dhpk:flow-guide help flow-drive

  # Consult route for a new task (advisory only, no downstream execution)
  /dhpk:flow-guide route implement user password reset email notification

  # Consult and automatically hand off to an implicit-eligible target
  /dhpk:flow-guide route --go investigate user login captcha timeout issue

  # Query suggested next action in the current workspace
  /dhpk:flow-guide next

  # Run full closeout gate checks before committing or finalizing
  /dhpk:flow-guide close
  ```

#### 2. flow-drive (Confirmed Specification Implementation Entrypoint)

- **Purpose**: Explicit-only implementation entrypoint for changes with confirmed specifications and acceptance boundaries. Never selects routes, drafts proposals, or skips tests.
- **Invocation Syntax**: `/dhpk:flow-drive <confirmed-spec-or-change-id> [options]` (Codex: `$flow-drive ...`)
- **Parameter Breakdown**:

  | Parameter | Type / Choices | Default | Description |
  |---|---|---|---|
  | `<confirmed-spec-or-change-id>` | String | (Required) | Settled specification name or OpenSpec Change ID (e.g., `auth-oauth2-flow`). |
  | `--plan[=<model>:<effort>]` | String (optional value) | None | Request pre-implementation critique by a Planner; optionally specify model and reasoning effort (e.g., `opus:xhigh`, `sonnet:high`). |
  | `--plan-mode=<mode>` | `auto` \| `bounded` \| `discovery` | `auto` | Planner consult scope (requires `--plan`). `bounded` limits to max 4 direct reads with no child agent; `discovery` allows full exploration. |
  | `--worker=<worker>` | `claude` \| `codex` \| `agy` \| `auto` | `auto` | Select mechanical Worker type for this change (typically uses current model). |
  | `--worker-target=<target>` | `<provider>/<model>[:<effort>]` | None | Explicitly designate execution target provider and model (e.g., `anthropic/claude-3-7-sonnet`). |
  | `--cross-provider` | Boolean flag | Off | Allow external cross-provider candidates (such as Codex) when `--worker=auto` is used. |
  | `--reasoner=<target>` | `<provider>/<model>[:<effort>]` | None | Request an external read-only Reasoner pass for architecture or complex decisions (e.g., `codex-cli/gpt-6.1-sol:high`). |
  | `--architect` / `--no-architect` | Boolean flag | Policy default | Explicitly enable or bypass the architectural design review pass. |

- **Practical Examples**:
  ```text
  # Minimal implementation: execute confirmed change in the current environment
  /dhpk:flow-drive change-add-user-avatar

  # Implementation with bounded Planner consult
  /dhpk:flow-drive change-add-user-avatar --plan --plan-mode=bounded

  # High-effort planning model and designated Worker
  /dhpk:flow-drive payment-webhook-retry --plan=opus:xhigh --worker=claude

  # Implementation with CLI Reasoner second opinion and architecture pass
  /dhpk:flow-drive refactor-auth-tokens --architect --reasoner=codex-cli/gpt-6.1-sol:high
  ```

#### 3. code-trace (Code Exploration, Root-Cause Diagnosis & Tool Selection)

- **Purpose**: Read-only code exploration and diagnostic tool. Traces call hierarchies, reproduces failures, inspects Git history, or selects optimal code-navigation tools.
- **Invocation Syntax**: `/dhpk:code-trace [--mode <mode>] [options] <target>`
- **Parameter Breakdown**:

  | Parameter | Type / Choices | Default | Description |
  |---|---|---|---|
  | `--mode <mode>` | `explore` \| `diagnose` \| `history` \| `select-tool` | Inferred | Trace mode. `explore` (symbols/flows), `diagnose` (bugs/regressions), `history` (Git evolution), `select-tool` (navigation tool selection). |
  | `--depth <depth>` | `brief` \| `normal` \| `deep` | `normal` | Report verbosity and traversal depth. |
  | `--dual` | Boolean flag | Off | Dispatches two fully isolated exploration perspectives and reconciles consensus vs differences. |
  | `--explain` | Boolean flag | Off | Generates step-by-step explanatory prose and dataflow narrative. |
  | `<target>` | String | (Required) | Symbol name, class, file path, error message, or symptom description. |

- **Practical Examples**:
  ```text
  # Deeply explore authentication flow architecture
  /dhpk:code-trace --mode explore --depth deep "App\Services\AuthManager"

  # Dual-perspective independent exploration of a state machine
  /dhpk:code-trace --mode explore --dual "OrderStateMachine"

  # Diagnose bug root-cause and reproduction conditions
  /dhpk:code-trace --mode diagnose "OAuth2 redirect loop on Safari"

  # Trace recent commit history and breaking changes for a function
  /dhpk:code-trace --mode history "UserController::updateProfile"

  # Determine optimal navigation tool route (cx vs gitnexus vs grep)
  /dhpk:code-trace --mode select-tool "Find all callers of PaymentGateway::charge"
  ```

#### 4. change-verdict (Change Review & Multi-Dimensional Quality Verdict)

- **Purpose**: Read-only quality review skill providing evidence-backed verdicts (`READY`, `BLOCKED`, or `INCONCLUSIVE`) across code standards, security, test coverage, documentation consistency, and change risk.
- **Invocation Syntax**: `/dhpk:change-verdict --mode <mode> [options] [scope]`
- **Parameter Breakdown**:

  | Parameter | Type / Choices | Default | Description |
  |---|---|---|---|
  | `--mode <mode>` | `code` \| `pr` \| `security` \| `tests` \| `docs` \| `risk` | (Required) | Review dimension. `code` (standards/spec), `pr` (PR hygiene), `security` (OWASP/secrets), `tests` (coverage), `docs` (consistency), `risk` (blast radius). |
  | `--ac-trace` | Boolean flag | Off | Used in `tests` mode: traces acceptance criteria to concrete test cases and outcomes. |
  | `--second-opinion=codex-exec` | String | None | Requests an independent blind review pass via Codex CLI, presented in isolation. |
  | `[scope]` | Commit range / branch / file list | Uncommitted diff | Review scope (e.g., `HEAD~1..HEAD`, `main..feature`, or `app/Models/`). |

- **Practical Examples**:
  ```text
  # Review all uncommitted code modifications against project standards
  /dhpk:change-verdict --mode code

  # Audit branch diff for OWASP security vulnerabilities
  /dhpk:change-verdict --mode security origin/main..HEAD

  # Trace acceptance criteria against test suite evidence
  /dhpk:change-verdict --mode tests --ac-trace

  # Assess breaking change risk and blast radius of working tree
  /dhpk:change-verdict --mode risk

  # Check documentation consistency against current implementation
  /dhpk:change-verdict --mode docs docs/basic-operations.md
  ```

#### 5. review-pending (Pending Changes Review Dispatcher)

- **Purpose**: Automatically inspects working tree changes and dispatches specialist reviewers (code, database, security, frontend, docs) based on edited file paths.
- **Invocation Syntax**: `/dhpk:review-pending [--files=<rel-paths>]`
- **Parameter Breakdown**:

  | Parameter | Type | Default | Description |
  |---|---|---|---|
  | `--files=<rel-paths>` | Comma-separated string | `git diff HEAD --name-only` | Restrict review to specific relative file paths. Defaults to all modified files. |

- **Practical Examples**:
  ```text
  # Review all currently modified (staged + unstaged) files
  /dhpk:review-pending

  # Review only designated critical files
  /dhpk:review-pending --files="app/Models/User.php,routes/api.php"
  ```

#### 6. tdd-workflow (Test-Driven Development Workflow)

- **Purpose**: Guides strict behavior-first unit and integration testing following RED → GREEN → REFACTOR, eliminating tautological test antipatterns.
- **Invocation Syntax**: `/dhpk:tdd-workflow <mode> [target]`
- **Parameter Breakdown**:

  | Parameter | Type / Choices | Required | Description |
  |---|---|---|---|
  | `<mode>` | `standard` \| `test-generation` \| `fast-worker` | Yes | TDD operational mode. |
  | `standard` | Mode | — | Full TDD cycle: write failing test (RED) -> minimal code to pass (GREEN) -> clean up (REFACTOR). |
  | `test-generation` | Mode | — | Generate a minimal behavior-focused test scaffold for an existing production seam. |
  | `fast-worker` | Mode | — | Mechanical GREEN implementation driven by settled RED specs or task contracts. |
  | `[target]` | String | No | Target file, method, or production seam name. |

- **Practical Examples**:
  ```text
  # Initiate standard TDD cycle for a new behavior
  /dhpk:tdd-workflow standard "lock account for 15 minutes after three invalid login attempts"

  # Generate behavior test scaffold for an existing controller
  /dhpk:tdd-workflow test-generation "app/Http/Controllers/Api/OrderController.php"

  # Fast mechanical execution of the GREEN pass
  /dhpk:tdd-workflow fast-worker "tests/Unit/DiscountCalculatorTest.php"
  ```

#### 7. precommit (Pre-Commit Quality Pipeline)

- **Purpose**: Deterministic pre-commit verification pipeline executing lint formatting, build checks, and unit tests tailored to the project ecosystem.
- **Invocation Syntax**: `/dhpk:precommit [--fast]`
- **Parameter Breakdown**:

  | Parameter | Type | Description |
  |---|---|---|
  | `--fast` | Boolean flag | Fast mode: runs rapid static checks and unit tests, skipping heavy builds and end-to-end stages. Omitted = runs full pipeline (`lint:fix -> build -> test:unit`). |

- **Practical Examples**:
  ```text
  # Run fast pre-commit check
  /dhpk:precommit --fast

  # Run full deterministic quality gate
  /dhpk:precommit
  ```

#### 8. repo-verify / /dhpk:verify (Repository Cross-Layer Verification)

- **Purpose**: Read-only cross-layer validation across all project levels (lint, typecheck, unit, integration, e2e).
- **Invocation Syntax**: `/dhpk:verify [<mode>] [--integration=<path>] [--e2e=<path>]` (Codex: `$repo-verify ...`)
- **Parameter Breakdown**:

  | Parameter | Type / Choices | Default | Description |
  |---|---|---|---|
  | `<mode>` | `fast` \| `full` | `full` | Verification mode. `fast` (lint + unit tests); `full` (all stages: lint + typecheck + unit + integration + e2e). |
  | `--integration=<path>` | String | None | Specify custom integration test path. |
  | `--e2e=<path>` | String | None | Specify custom end-to-end test path. |

- **Practical Examples**:
  ```text
  # Run full repository verification
  /dhpk:verify

  # Run fast verification stage
  /dhpk:verify fast

  # Run full verification with customized test directories
  /dhpk:verify full --integration=tests/Integration --e2e=tests/E2E
  ```

#### 9. smart-commit (Smart Atomic Batch Commit)

- **Purpose**: Analyzes unstaged/staged files, groups them by cohesion, formats Conventional Commit messages matching project conventions, and produces copy-pasteable Git commands.
- **Invocation Syntax**: `/dhpk:smart-commit [--scope <path>] [--type <type>] [--ai-co-author]`
- **Parameter Breakdown**:

  | Parameter | Type | Description |
  |---|---|---|
  | `--scope <path>` | Path string | Restrict staging and commit grouping to a designated directory or path. |
  | `--type <type>` | String | Enforce commit type prefix (e.g., `feat`, `fix`, `refactor`, `docs`, `test`, `chore`). |
  | `--ai-co-author` | Boolean flag | Append AI co-author trailer (`Co-authored-by: ...`) to commit messages. |

- **Practical Examples**:
  ```text
  # Analyze all working tree changes and group into atomic commits
  /dhpk:smart-commit

  # Stage only frontend assets and enforce refactor type
  /dhpk:smart-commit --scope resources/assets/js --type refactor

  # Include AI co-author trailer
  /dhpk:smart-commit --ai-co-author
  ```

#### 10. create-pr (Pull Request Creation)

- **Purpose**: Extracts ticket IDs from branch history and commits, composing project-compliant PR titles, summaries, and verification evidence.
- **Invocation Syntax**: `/dhpk:create-pr [--head=<branch>] [--base=<branch>] [--title=<text>] [--execute] [--dry-run]`
- **Parameter Breakdown**:

  | Parameter | Type | Default | Description |
  |---|---|---|---|
  | `--dry-run` | Boolean flag | Enabled | Outputs copy-pasteable `gh pr create` command preview without making changes. |
  | `--execute` | Boolean flag | Off | Actually executes `gh pr create` and returns the resulting PR URL. |
  | `--head=<branch>` | String | Current branch | Source branch to open PR from. |
  | `--base=<branch>` | String | `develop` or `main` | Target branch (defaults to project configured target branch). |
  | `--title=<text>` | String | Auto-generated | Explicit PR title overriding ticket-aware default. |

- **Practical Examples**:
  ```text
  # Preview PR title, body, and gh command (dry-run mode)
  /dhpk:create-pr

  # Open PR targeting develop branch
  /dhpk:create-pr --execute

  # Target main branch with custom title
  /dhpk:create-pr --base=main --title="feat: [PROJ-890] Refactor checkout payment pipeline" --execute
  ```

#### 11. dhpk-deploy-list (Cross-Ecosystem Deploy File-List Generator)

- **Purpose**: Generates a release file checklist from Git history, filtering dev-only assets (tests, CI, docs) and grouping files by ecosystem preset (Yii, Laravel, Node, Python, generic).
- **Invocation Syntax**: `dhpk-deploy-list --tag <[TAG]> --description "<text>" [options]`
- **Parameter Breakdown**:

  | Parameter | Type | Required | Description |
  |---|---|---|---|
  | `--tag <[TAG]>` | String | Yes | Release tag metadata (must match bracket format `^\[.+\]$`, e.g. `[PROD-20261006]`). |
  | `--description "<text>"` | String | Yes | Freeform release summary. |
  | `--deploy-commits <shas>` | Comma-separated string | No | Pinned commit SHAs; diff union forms the primary deployment group. |
  | `--anchor "<string>"` | String | No | Search source files for an inline anchor marker (mutually exclusive with `--deploy-commits`). |
  | `--base <ref>` / `--head <ref>` | Git ref | No | Git revision comparison range (default: `main..HEAD`). |
  | `--preset <preset>` | String | No | Ecosystem preset rule (`php-yii`, `laravel`, `node`, `python`, `generic`). |
  | `--lang <en\|zh-TW>` | String | No | Output checklist language (default: `en`). |
  | `--auto-detect-tag` | Boolean flag | No | Auto-search `$TAG` in commit messages to populate `--deploy-commits`. |

- **Practical Examples**:
  ```text
  # Generate standard deployment checklist against main
  dhpk-deploy-list --tag="[RELEASE-1.4.0]" --description="User profile redesign" --lang=en

  # Pin specific commit range for hotfix release
  dhpk-deploy-list --tag="[HOTFIX-20261006]" --description="Fix checkout float precision" --deploy-commits="a1b2c3d,e4f5a6b" --lang=en
  ```

#### 12. opsx-apply-resume (Long-Running Task Context Save & Resume)

- **Purpose**: Snapshots live workspace state when approaching context/token limits in long apply sessions, and restores execution progress and verification gates in a fresh session.
- **Invocation Syntax**: `/dhpk:opsx-apply-resume [<change-id>]`
- **Parameter Breakdown**:

  | Parameter | Type | Description |
  |---|---|---|
  | `<change-id>` | String (optional) | Target OpenSpec Change ID. If omitted, automatically detects latest active change. |

- **Practical Examples**:
  ```text
  # Save live state before context exhaustion in current session
  /dhpk:opsx-apply-resume change-refactor-auth-v2

  # Resume in-progress change in a fresh session
  /dhpk:opsx-apply-resume
  ```

## Sync Codex CLI content

Projects using both Claude Code and Codex CLI:

The `${CLAUDE_PLUGIN_ROOT}` form below is for a Claude Code plugin-runtime
shell. In an ordinary terminal use the persistent-checkout form documented in
[Update / Uninstall](#update--uninstall).

```bash
# From any project root and a persistent local dhpk checkout:
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh"
```

Inside a Claude plugin-runtime shell, `${CLAUDE_PLUGIN_ROOT}` may be used as an
equivalent root. A normal terminal must set `DHPK_ROOT` explicitly; never copy
an ephemeral marketplace-cache path into a project command.

The script is the supported Codex distribution path, with a hybrid default
and a fully physical fallback:

- **`--copy` (portable supported fallback).** Materializes every managed entry
  under `.codex/`. Recommended whenever the project may move, be archived, or be
  checked out somewhere the plugin source tree isn't guaranteed to sit
  alongside it — copied content has no dependency on the plugin checkout
  surviving.
- **Hybrid (default, source-checkout dependent).** Links skills and supporting
  assets back to the plugin source, but always writes agent TOMLs as physical
  files. Linked entries are faster to re-sync and stay current with the source
  checkout, but those links break if that plugin
  root/cache is moved, pruned, or deleted. A marketplace cache is a
  valid source while it remains present; `--update` can adopt a new owned
  plugin root. Broken source lifetime was the failure mode behind
  [issue #88](https://github.com/hmj1026/dhpk/issues/88). Use `--copy`
  instead whenever the plugin source's continued presence isn't guaranteed.

Both modes record version, source-fingerprint, and per-entry mode in schema-v3
managed provenance at `.codex/.dhpk-installed.json`; skill entries include
their stable inventory id and current public `dhpk-*` name. Re-run with
`--update` after a
plugin update. Unowned collisions are preserved, and `--migrate` renames only
receipt-owned unchanged legacy destinations; edited, third-party, retargeted,
malformed, or ambiguous legacy paths remain reported conflicts. Use
`--uninstall` to remove unchanged receipt-owned entries without deleting
unrelated project assets.
The Codex tree is an explicitly curated subset of the canonical Claude
packages, not a second complete inventory. `codex/agents/` ships 15 direct
roles: four hand-maintained generic roles and 11 generated from canonical
Claude agents via `scripts/gen-codex-agents.js`. See `codex/guidance.md` and
`codex/README.md` for the dual-harness model.

Generated roles may depend on shared prompt-defense, trap-sheet,
artifact-contract, or execution-policy content. Those support files are mapped in
the `supporting_assets` section of `manifests/distribution-inventory.json`, copied
under `.codex/dhpk/`, and tracked in the same schema-v3 receipt. The runtime
projection validator rejects unreachable references or Claude plugin-root paths.

### Codex Plugin Marketplace (experimental support tier)

The repository ships a Codex plugin manifest and marketplace wrapper backed
by a tracked, physical publication package at `plugins/dhpk/` — generated
from `manifests/distribution-inventory.json`'s explicit `codex-native`
surface, containing zero symlinks. Use this route only with a fresh disposable
isolated `CODEX_HOME`, with no project-local `.codex/` projection. These
surfaces are separately published/acquired, but must not be activated together.

```bash
codex plugin marketplace add hmj1026/dhpk   # or a local path during development
codex plugin add dhpk@dhpk
codex plugin list
```

The commands above are conditional repository instructions for a CLI that
supports the route; official Codex documentation is not dhpk-specific install
proof.

Experimental lifecycle commands (the marketplace upgrade form applies to a
configured Git marketplace; for a local-path development marketplace, refresh
or re-add that local source before reinstalling the plugin):

```bash
codex plugin marketplace upgrade dhpk
codex plugin remove dhpk@dhpk
codex plugin add dhpk@dhpk        # reinstall from the refreshed snapshot

# Full teardown:
codex plugin remove dhpk@dhpk
codex plugin marketplace remove dhpk
```

`codex plugin list` is management evidence only; it does not by itself prove
the installed cache contains working files. That proof is a real,
CLI-driven test: `tests/codex-native-install-smoke.test.js` installs the
exact tracked `plugins/dhpk/` artifact into a sandboxed `CODEX_HOME`,
deletes the source checkout, and verifies every allowlisted native skill
materialized as a real (non-symlink) file — the exact failure mode
[issue #88](https://github.com/hmj1026/dhpk/issues/88) tracked is closed at
the manifest level (both `.codex-plugin/plugin.json` and
`plugins/dhpk/.codex-plugin/plugin.json` now resolve to the same tracked
physical tree). This proof runs as part of the release CONSUMER gate
whenever a `codex` CLI is available; see
[`docs/distribution-surfaces.md`](./distribution-surfaces.md#codex-native-plugin-package)
for the full gate model.

A passing install proof is necessary evidence, not sufficient by itself:
native Codex marketplace support remains **experimental** until a later,
separately approved graduation decision (see
[ADR-0006](./adr/0006-codex-native-publication-artifact.md)). The two packages
are separately published and acquired, but runtime activation is mutually
exclusive. For production work, use `install-codex-skills.sh` as the canonical
project-local sync route; do not activate the native package on the same host.

If the native plugin is enabled and you choose project-local sync, remove it
manually with `codex plugin remove dhpk@dhpk`, then start a new Codex session.
The sync installer checks `codex plugin list --json` before install, update,
migrate, and plan: a positively enabled native plugin blocks those operations
before writes, and `--force` cannot bypass the gate. `--uninstall` remains
available. If the query is missing or unsupported, the result reports
`providerCheck: UNAVAILABLE` and sync may proceed; the installer never removes
the global plugin automatically. Do not delete the whole `.codex/` directory.

See `.codex-plugin/README.md` and `plugins/dhpk/README.md` for details.

## Migrating an existing project

If the project already has its own `.claude/` harness, the following is a
legacy migration plan for hook compatibility. New review work uses the advisory
reviewer trigger table described above.

1. **Phase A — baseline**: snapshot pre-install hook outputs and test results.
2. **Phase B — install (parallel)**: install the plugin with `userConfig.review_agents` pointing at the project's existing agents. Both sets of hooks fire side-by-side.
3. **Phase C — discovery**: confirm `/agents` and `/plugin details dhpk@dhpk` show expected components.
4. **Phase D — hook parity**: diff plugin-side safety hooks vs project-side. Document any expected differences; do not add a legacy sentinel route.
5. **Phase E — cutover**: disable the project's in-tree hooks via `.claude/settings.local.json` (`"hooks": {}`); run regression tests.
6. **Phase F — cleanup**: delete project files now provided by the plugin; keep project-specific overrides.

Each phase has a rollback gate. Tag `pre-dhpk-migration` before deleting anything.

## Development

For iterating on the plugin source itself (no install/reinstall loop), launch Claude Code against the working tree directly:

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude --plugin-dir ~/projects/dhpk
```

Edits to plugin files take effect after `/reload-plugins` (hooks, MCP, LSP) or session restart (monitors, skill listings).

The marketplace install path (`claude plugin install`) copies the plugin into `~/.claude/plugins/cache/`, so edits to the source repo do NOT take effect there until `claude plugin update -y dhpk@dhpk` (or the equivalent command with `--scope project` for a project-scoped install).

### npm script shortcuts

The root `package.json` is private and has zero dependencies. It offers two kinds of commands.

**For package installers (`bin`)** — available through `npx` or after a global install:

| Command | Purpose |
|---------|---------|
| `dhpk-install <claude\|cursor\|codex-sync\|agy-plugin> <plan\|status\|verify>` | Plan, check, or verify an install surface |
| `dhpk harness ...` | Harness facade |
| `dhpk distribution <surface> <generate\|preview\|validate\|verify>` | Distribution package operations |

**For developers (`npm run` inside a clone)**:

| Group | Command | Runs |
|-------|---------|------|
| Setup | `npm run setup` | Interactive installer (`scripts/install.sh`) |
| | `npm run setup:dry-run` | Non-interactive installer dry run |
| | `npm run setup:status` | `dhpk-install claude status --scope user` |
| | `npm run dhpk-install -- <surface> <action>` | `scripts/dhpk-install.js` |
| Test | `npm test` | Full suite (`tests/run-all.js`) |
| | `npm run test:hooks` | Hook tests |
| | `npm run test:one -- tests/<name>.test.js` | One test file |
| Validate | `npm run validate` | Every CI validator (`validate:*`) |
| | `npm run check:generated` | Generated manifest, marketplace, skill-resource, and package drift checks |
| | `npm run check:portability` | Portability check |
| | `npm run catalog:check` | `catalog.js --check all` |
| | `npm run ci` | `validate` + `check:generated` + `catalog:check` + `test` |
| Generate (writes files) | `npm run gen:all` | `catalog:write`, then `gen:manifest`, `gen:marketplace`, `gen:codex-agents` |

Notes:
- `catalog:write` must run before the other generators; `gen:all` keeps that order.
- No npm lifecycle script (`install`, `postinstall`, `prepare`, ...) is defined, so installing the package never runs developer scripts.
- Release scripts and `gen-distribution-inventory.js --write` are intentionally not exposed; run them by hand.
- The `package.json` version is part of the release version lockstep.
