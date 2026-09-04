# Skill platform consolidation, migration, and Codex MCP retirement

> **Languages**: **English** · [繁體中文](./skill-platform-migration.zh-TW.md)

This guide is the upgrade contract for the collision-safe skill platform. It
applies to maintainers, Claude marketplace consumers, projects that sync dhpk
into `.codex/`, and users who also have Matt Pocock or other global skills
installed.

Current Codex/Cursor installation routes and rollback boundaries live in the
[platform installation SSOT](./platform-installation.md).

## Current contract

| Concern | Current implementation |
|---|---|
| Canonical source | 65 flat packages at `skills/<public-name>/` (all active in 0.54) |
| Public identity | Nine capability families use unprefixed names; the other 56 first-party names retain `dhpk-*` |
| Inventory SSOT | `manifests/distribution-inventory.json` schema v2 |
| Module projection | 37 relative symlinks under `modules/*/skills/` |
| Codex project projection | 15 relative symlinks under `codex/skills/` (13 invokable plus two internal transport and dispatch-context runtimes) |
| Codex native package | 15 physical packages under `plugins/dhpk/skills/`; zero symlinks |
| Codex project receipt | `.codex/.dhpk-installed.json` schema v3 |
| Default hooks | `PreToolUse`, `PostToolUse`, `SessionStart`, `SubagentStop` |
| Profile sizes | `minimal=8`, `full=55`, `compat-v1=62` before overlays |
| Shared Agent/Cursor/AGY surface | 37 selected stable IDs per surface |

Directory placement and README lists are not authoritative. The inventory
owns stable ids, public names, lifecycle, modules, and publication surfaces;
the validators reconcile every projection against it.

## Invocation syntax

Names are deliberately different across host surfaces:

| Surface | Syntax | Example |
|---|---|---|
| Claude command | `/dhpk:<command>` | `/dhpk:harness-audit` |
| Claude plugin skill | `/dhpk:<public-skill-name>` | `/dhpk:change-verdict` |
| Codex skill | `$<public-skill-name>` after discovery | `$change-verdict --mode code` |
| Cursor generated command | generated host adapter | Cursor `do` command (`host=cursor`) |
| Codex guidance entry | `$flow-guide <help|route|rules|next|close> [--go] [query]` after discovery | `$flow-guide help flow-drive` |
| Codex implementation entry | `$flow-drive <confirmed-spec-or-change-id>` after discovery | `$flow-drive my-change-id --plan` |

Codex built-in commands (`/hooks`, `/agent`) are not dhpk custom `/dhpk:*`
commands. `flow-guide` owns read-only usage help, routing, policy, progression,
and closeout; `flow-drive` is the explicit-only, mode-free implementation entry
for a confirmed specification or OpenSpec change. Availability evidence is a
receipt-owned `.codex/skills/flow-guide` or `.codex/skills/flow-drive` that
resolves as the corresponding `$name`; `codex plugin list` is management
evidence only. If a family is not discovered, instruction routing and explicit
`/opsx:*` OpenSpec commands remain available — do not claim the missing `$name`
is callable in Codex.

Codex parameter discovery is progressive: `$flow-guide help` lists the current
catalogue and `$flow-guide help <skill>` returns one metadata-only usage card.
The generated catalogue is [`codex-usage-catalog.json`](../skills/flow-guide/references/codex-usage-catalog.json),
with the human guide in [`codex-skill-usage.md`](codex-skill-usage.md). Help
does not load target procedures or grant their authority.

Proposal authoring and feasibility comparison have their own handoffs:
[OpenSpec authoring](./agent-guidance/openspec-authoring.md) routes confirmed
proposals to the external `$openspec-propose` owner, while
[feasibility comparison](./agent-guidance/feasibility-comparison.md) keeps
options analysis separate from implementation.

The `dhpk` prefix remains part of the Claude plugin namespace. The nine family
names are intentionally unprefixed so users select a task-shaped capability
without learning predecessor implementation names. `git-smart-commit` remains
the standalone public commit owner; it is not renamed to or replaced by a
`commit-craft` family.

## Alias-free retirement ledger (0.47.0)

`manifests/distribution-inventory.json` is the source of truth for retirement
identity. Its `retired_skills` contains five historical 0.47.0 rows plus the later retirement
waves; the table below is the documentation projection of those historical
rows' former identity, `reasonCode`,
replacement guidance, and rollback pin. Retirement rows are diagnostic
metadata only: they are not active skills, materialized packages, discovery
aliases, or entries in any generated projection.

| Former stable ID | Former public name | `reasonCode` | Replacement guidance | `rollback.release` |
|---|---|---|---|---|
| `bug-fix` | `dhpk-bug-fix` | `merged-into-adaptive-workflow` | current successor `flow-guide` (`classify` mode); the historical 0.47.0 route was `adaptive-dev-workflow` (`bug` mode) | `0.46.1` |
| `feature-dev` | `dhpk-feature-dev` | `merged-into-adaptive-workflow` | current successor `flow-guide` (`classify` mode); the historical 0.47.0 route was `adaptive-dev-workflow` (`feature` mode) | `0.46.1` |
| `post-dev-test` | `dhpk-post-dev-test` | `split-by-test-level` | stable ID `tdd`; Claude `/dhpk:dhpk-tdd-workflow`; Codex `$dhpk-tdd-workflow` (`unit-integration` mode); agent `e2e-runner` (`playwright-journey` mode) | `0.46.1` |
| `codex-brainstorm` | `dhpk-codex-brainstorm` | `merged-into-architect-mode` | stable ID `software-architecture`; Claude `/dhpk:dhpk-module-design`; Codex `$dhpk-module-design` (`adversarial` mode) | `0.46.1` |
| `de-ai-flavor` | `dhpk-de-ai-flavor` | `model-default-capability-removal` | `model-default` guidance; no successor package | `0.46.1` |

### Direct-host invocation boundary

This is release-prep documentation: the checked-in package/provenance metadata
still targets `0.46.1` until a final clean release commit publishes `0.47.0`.

Dhpk-owned helper, package, and receipt-bound installation interfaces that
accept a skill identity can intercept these rows and return a stable non-zero
retirement diagnostic with the release, reason, and successor or
model-default guidance. The `scripts/run-skill.sh` seam is one such helper;
receipt-bound planning/update reports retirement evidence without materializing
an alias. An external host that invokes a Skill directly bypasses these
dhpk-owned seams. Its response remains host-owned and may be `unknown-skill`;
dhpk does not claim that unsupported direct invocation is interceptable or that
the former name remains resolvable.

Rollback is version pinning, not hidden aliasing: pin and reinstall the last
compatible release through its receipt-bound installation path rather than
reconstructing a retired package or discovery alias. The Codex MCP capability
retirement below pins `0.51.0`, the last compatible release with that grant.

<a id="alias-free-codex-mcp-retirement-ledger"></a>

## Alias-free Codex MCP capability retirement ledger (0.52.0)

This is the historical-only ledger for the nine MCP-backed capability
identities retired by the current migration. It is not an active route registry:
none of these former MCP identities is an alias, generated package, discovery
target, or hidden fallback. The parity matrix records the complete capability
evidence; this table records the identity disposition and rollback pin.

| Former stable ID | Former MCP-facing identity | Replacement owner and behavior | `reasonCode` | `rollback.release` |
|---|---|---|---|---|
| `codex-architect` | `dhpk-codex-architect` | `dhpk-module-design`; current-model design/review/compare/adversarial modes, with explicit optional `codex exec` only | `migrated-to-module-design` | `0.51.0` |
| `codex-implement` | `dhpk-codex-implement` | `flow-drive`; current-model decomposition, implementation, verification, review, and bounded retry loop (`implement` mode) | `migrated-to-backend-neutral-implement` | `0.51.0` |
| `codex-code-review` | `dhpk-change-review` with the MCP default | `dhpk-change-review --backend cli`; current-model default and explicit CLI review, with no MCP fallback | `migrated-to-cli-review-owner` | `0.51.0` |
| `doc-review` | `dhpk-doc-review` with MCP review/reply | `dhpk-doc-review`; portable five-dimension review and gate, with explicit optional `codex exec` only | `migrated-to-portable-review` | `0.51.0` |
| `test-review` | `dhpk-test-review` with MCP review/reply | `dhpk-test-review`; portable sufficiency, edge-case, quality, and AC-trace review; generation remains `dhpk-tdd-workflow` | `migrated-to-portable-review` | `0.51.0` |
| `codebase-exploration` | `dhpk-codebase-exploration` with MCP dual perspective | `dhpk-codebase-exploration`; current-model trace plus isolated or explicitly selected CLI second opinion | `migrated-to-isolated-perspective` | `0.51.0` |
| `feature-verify` | `dhpk-feature-verify` with MCP P5 verdict | `dhpk-feature-verify`; independent reviewer is explicit-only and primary-only results are marked degraded | `migrated-to-explicit-reviewer` | `0.51.0` |
| `issue-analyze` | `dhpk-issue-analyze` with a fresh MCP verdict | `dhpk-issue-analyze`; current-model classification with isolated or explicitly selected CLI blind opinion | `migrated-to-explicit-reviewer` | `0.51.0` |
| `feasibility-study` | `dhpk-feasibility-study` with MCP discussion/reply | `dhpk-feasibility-study`; current-model options/comparison with isolated or explicitly selected CLI opinion | `migrated-to-explicit-reviewer` | `0.51.0` |

The rollback path for every row is the same: pin the last compatible `0.51.0`
release and reinstall it through the receipt-bound installation flow. Never
restore one of these names as a discovery alias or add a silent MCP retry to
the current release. See the [capability-parity matrix](./codex-mcp-capability-parity.md)
for the eight rows (the issue and feasibility owners intentionally share one
row) and their migration evidence.

## Historical 0.53 capability families

The 22 first-party discovery identities retired in 0.53.0 were addressed by six
mode-shaped families. This section is preserved as the 0.53 historical record;
the live 0.54 family contract follows the second-wave ledger below. The
predecessor stable IDs remain only in historical retirement metadata.

| Current family | Modes | Retained predecessor contracts |
|---|---|---|
| `skill-scope` | `health`, `judge`, `stocktake`, `scout` | skill health, quality, inventory, and discovery checks |
| `skill-forge` | `create`, `distill-rules` | skill authoring and rule distillation |
| `flow-guide` | `classify`, `policy`, `next`, `checklist` | workflow classification, execution policy, progression, and closeout |
| `flow-drive` | `route`, `implement` | deterministic routing and ordered implementation |
| `change-verdict` | `code`, `pr`, `security`, `tests`, `docs`, `risk` | read-only code, PR, security, test, documentation, and risk verdicts |
| `code-trace` | `explore`, `diagnose`, `history`, `select-tool` | code exploration, root-cause, history, and tool-selection traces |

Mode-specific mechanics remain behind each family's conditional references;
there are no compatibility aliases or duplicate predecessor packages.

## Capability-family retirement ledger (0.53.0)

The inventory owns exactly 22 alias-free rows. Every row uses
`reasonCode: capability-family-consolidation`, rolls back to `0.52.0`, and
points to one family mode. This table is a documentation projection of that
closed mapping; it is not a discovery or compatibility registry.

| Former stable ID | Former public name | Replacement family/mode | `reasonCode` | `rollback.release` |
|---|---|---|---|---|
| `skill-health-check` | `dhpk-skill-health-audit` | `skill-scope` / `health` | `capability-family-consolidation` | `0.52.0` |
| `skill-judge` | `dhpk-skill-quality-judge` | `skill-scope` / `judge` | `capability-family-consolidation` | `0.52.0` |
| `skill-stocktake` | `dhpk-skill-stocktake` | `skill-scope` / `stocktake` | `capability-family-consolidation` | `0.52.0` |
| `skill-scout` | `dhpk-skill-scout` | `skill-scope` / `scout` | `capability-family-consolidation` | `0.52.0` |
| `create-skill` | `dhpk-create-skill` | `skill-forge` / `create` | `capability-family-consolidation` | `0.52.0` |
| `rules-distill` | `dhpk-rules-distill` | `skill-forge` / `distill-rules` | `capability-family-consolidation` | `0.52.0` |
| `adaptive-dev-workflow` | `dhpk-adaptive-dev-workflow` | `flow-guide` / `classify` | `capability-family-consolidation` | `0.52.0` |
| `dhpk-execution-policy` | `dhpk-execution-policy` | `flow-guide` / `policy` | `capability-family-consolidation` | `0.52.0` |
| `next-step` | `dhpk-next-step` | `flow-guide` / `next` | `capability-family-consolidation` | `0.52.0` |
| `execution-checklist` | `dhpk-execution-checklist` | `flow-guide` / `checklist` | `capability-family-consolidation` | `0.52.0` |
| `do` | `dhpk-do` | `flow-drive` / `route` | `capability-family-consolidation` | `0.52.0` |
| `implement` | `dhpk-implement` | `flow-drive` / `implement` | `capability-family-consolidation` | `0.52.0` |
| `codex-code-review` | `dhpk-change-review` | `change-verdict` / `code` | `capability-family-consolidation` | `0.52.0` |
| `pr-review` | `dhpk-pr-review` | `change-verdict` / `pr` | `capability-family-consolidation` | `0.52.0` |
| `security-review` | `dhpk-security-review` | `change-verdict` / `security` | `capability-family-consolidation` | `0.52.0` |
| `test-review` | `dhpk-test-review` | `change-verdict` / `tests` | `capability-family-consolidation` | `0.52.0` |
| `doc-review` | `dhpk-doc-review` | `change-verdict` / `docs` | `capability-family-consolidation` | `0.52.0` |
| `risk-assess` | `dhpk-risk-assess` | `change-verdict` / `risk` | `capability-family-consolidation` | `0.52.0` |
| `code-explore` | `dhpk-codebase-exploration` | `code-trace` / `explore` | `capability-family-consolidation` | `0.52.0` |
| `bug-investigation` | `dhpk-root-cause-investigation` | `code-trace` / `diagnose` | `capability-family-consolidation` | `0.52.0` |
| `git-investigate` | `dhpk-git-history-investigation` | `code-trace` / `history` | `capability-family-consolidation` | `0.52.0` |
| `tool-routing` | `dhpk-tool-routing` | `code-trace` / `select-tool` | `capability-family-consolidation` | `0.52.0` |

## Live 0.54 capability families and retirement

The 0.54 live catalogue has nine portable families and 65 active canonical
skills. The family names are `skill-scope`, `skill-forge`, `flow-guide`,
`flow-drive`, `change-verdict`, `code-trace`, `laravel`, `phpunit`, and
`harness-govern`; 56 other active public names retain the `dhpk-` prefix.

| Current family | Interface | Boundary |
|---|---|---|
| `skill-scope` | `health`, `judge`, `stocktake`, `scout` | explicit governance handoff |
| `skill-forge` | `create`, `distill-rules` | explicit authoring handoff |
| `flow-guide` | `help`, `route`, `rules`, `next`, `close` | read-only guidance; `route --go` is one bounded handoff |
| `flow-drive` | confirmed specification or change; no mode | explicit-only implementation |
| `change-verdict` | `code`, `pr`, `security`, `tests`, `docs`, `risk` | read-only review |
| `code-trace` | `explore`, `diagnose`, `history`, `select-tool` | evidence-backed investigation |
| `laravel` | selectors `5.4`, `6`, `7`, `8`, `9`, `10`, `11`, `mix` | version selection; one reference loaded |
| `phpunit` | selectors `9`, `10`, `11` | version selection; one reference loaded |
| `harness-govern` | `health`, `budget`, `fill`, `revise`, `sync` | explicit harness governance |

The inventory `usage` contract owns Codex syntax, actions, options, authority,
and examples. Users discover it with `$flow-guide help` or
`$flow-guide help <skill>`; the generated catalogue and human guide are linked
from [`docs/codex-skill-usage.md`](codex-skill-usage.md). `git-smart-commit`
remains a standalone public skill with its existing name; no `commit-craft`
family is introduced. OpenSpec proposal authoring belongs to the external
`$openspec-propose` skill. OnePassword setup is the operator action `op signin`.

### Capability-family retirement ledger (0.54.0)

The inventory owns exactly 21 new alias-free rows. Each row rolls back to
`0.53.0`; retirement records are diagnostic metadata only and never become
discovery aliases or generated packages.

| Former stable ID | Former public name | Replacement | `reasonCode` | `rollback.release` |
|---|---|---|---|---|
| `laravel-5.4-notes` | `dhpk-laravel-5-4-notes` | `laravel` / selector `5.4` | `version-family-alias-removal` | `0.53.0` |
| `laravel-6-notes` | `dhpk-laravel-6-notes` | `laravel` / selector `6` | `version-family-alias-removal` | `0.53.0` |
| `laravel-7-notes` | `dhpk-laravel-7-notes` | `laravel` / selector `7` | `version-family-alias-removal` | `0.53.0` |
| `laravel-8-notes` | `dhpk-laravel-8-notes` | `laravel` / selector `8` | `version-family-alias-removal` | `0.53.0` |
| `laravel-9-notes` | `dhpk-laravel-9-notes` | `laravel` / selector `9` | `version-family-alias-removal` | `0.53.0` |
| `laravel-10-notes` | `dhpk-laravel-10-notes` | `laravel` / selector `10` | `version-family-alias-removal` | `0.53.0` |
| `laravel-11-notes` | `dhpk-laravel-11-notes` | `laravel` / selector `11` | `version-family-alias-removal` | `0.53.0` |
| `laravel-mix-notes` | `dhpk-laravel-mix-notes` | `laravel` / selector `mix` | `version-family-alias-removal` | `0.53.0` |
| `phpunit-9-modern` | `dhpk-phpunit-9-modern` | `phpunit` / selector `9` | `version-family-alias-removal` | `0.53.0` |
| `phpunit-10-notes` | `dhpk-phpunit-10-notes` | `phpunit` / selector `10` | `version-family-alias-removal` | `0.53.0` |
| `phpunit-11-notes` | `dhpk-phpunit-11-notes` | `phpunit` / selector `11` | `version-family-alias-removal` | `0.53.0` |
| `claude-health` | `dhpk-claude-health` | `harness-govern` / `health` | `remaining-capability-family-consolidation` | `0.53.0` |
| `harness-budget` | `dhpk-harness-budget` | `harness-govern` / `budget` | `remaining-capability-family-consolidation` | `0.53.0` |
| `harness-fill` | `dhpk-harness-fill` | `harness-govern` / `fill` | `remaining-capability-family-consolidation` | `0.53.0` |
| `harness-revise` | `dhpk-harness-revise` | `harness-govern` / `revise` | `remaining-capability-family-consolidation` | `0.53.0` |
| `multi-ai-sync` | `dhpk-cross-agent-sync` | `harness-govern` / `sync` | `remaining-capability-family-consolidation` | `0.53.0` |
| `agy-commit` | `dhpk-agy-commit` | `git-smart-commit` | `remaining-capability-family-consolidation` | `0.53.0` |
| `feasibility-study` | `dhpk-feasibility-study` | `software-architecture` / `compare` | `remaining-capability-family-consolidation` | `0.53.0` |
| `tech-spec` | `dhpk-tech-spec` | external `openspec-propose` / `propose` | `openspec-authoring-consolidation` | `0.53.0` |
| `create-request` | `dhpk-create-request` | external `openspec-propose` / `propose` | `openspec-authoring-consolidation` | `0.53.0` |
| `op-session` | `dhpk-onepassword-session` | operator action `onepassword-cli` / `signin` | `operator-action-capability-removal` | `0.53.0` |

No compatibility alias is emitted for these rows. Edited or user-owned project
files remain protected during projection migration; rollback means pinning and
reinstalling 0.53.0, not recreating a retired name in 0.54.

The retired OnePassword wrapper is not a credential-migration mechanism. An
operator upgrading from 0.53.0 must run `op signout`, confirm that no process
still depends on the old session, inspect the ownership and contents policy of
`~/.op-claude-session`, and remove that legacy cache through the operator's
normal secure-file procedure. Automation must not read, print, copy, revoke, or
delete that file on the operator's behalf. Future access uses an interactive
`op signin` operator action with the narrowest required account and vault scope.

## Hooks and commands after consolidation

The default hook surface now has five focused responsibilities:

1. Protect edits to sensitive paths.
2. Combine shell safety and Git/review-debt checks before Bash.
3. Route post-edit review sentinels.
4. Validate and activate configured modules at session start.
5. Reconcile reviewer evidence at subagent stop.

Formatting, lint, Docker probes, prompt hints, session snapshots, and other
advisory work are explicit consumer extensions rather than default hooks.
See [Hook extension model](./hook-extension.md).

Commands remain namespaced `/dhpk:<name>` on Claude. Cursor uses the generated
command. Codex uses `$flow-guide` for discovery and advice, `$flow-drive` for
confirmed implementation, and has no `/dhpk:do` command. Overlapping workflows
use these primary entry points:

- `$flow-guide <help|route|rules|next|close> [--go] [query]` for Codex guidance.
- `$flow-drive <confirmed-spec-or-change-id> [implementation-options]` for Codex implementation.
- `/dhpk:flow-guide <help|route|rules|next|close> [query]` on Claude when explicitly invoked.
- `/dhpk:flow-drive <confirmed-spec-or-change-id> [implementation-options]` on Claude when explicitly invoked.
- `/dhpk:change-verdict --mode <code|pr|security|tests|docs|risk>` for read-only review variants.
- `/dhpk:precommit` with `--fast` where applicable.
- `/dhpk:setup --install hooks|rules|scripts|all` for configuration and assets.

No discovery or compatibility alias is published for the five `0.47.0`
retirements or the nine `0.52.0` Codex MCP capability retirements above. Any
unrelated command alias that remains for a separately documented compatibility
window is not a retired skill record and must not be used as a replacement for
one of these names.

## Upgrade a Claude marketplace installation

```bash
claude plugin update dhpk@dhpk
```

Start a fresh Claude session or run `/reload-plugins`. Confirm that
`/dhpk:setup`, `/dhpk:flow-guide`, `/dhpk:flow-drive`, and `/dhpk:harness-govern` resolve. Project-local
copies of old dhpk skills are not updated by the marketplace; remove them only
after confirming they are redundant and version controlled or otherwise
recoverable.

## Upgrade a project-local Codex projection

Run from the project root after updating the Claude plugin:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --migrate --update
```

The schema-v3 receipt records stable id, public name, destination, source,
mode, and fingerprint for every managed skill, agent, and supporting asset.
Migration adopts only unchanged exact legacy matches. It preserves and reports
user-owned, edited, retargeted, malformed, ambiguous, or colliding content.

Available operations:

| Flag | Contract |
|---|---|
| `--copy` | Materialize regular files; portable when the plugin root may disappear. |
| `--update` | Reconcile receipt-owned entries with the current plugin root. |
| `--migrate` | Adopt exact unchanged legacy destinations and rename them to the current public names. |
| `--uninstall` | Remove only unchanged receipt-owned entries; preserve edited/orphaned/unrelated files. |
| `--force` | Bypass only the project-root heuristic; never bypass ownership or filesystem safety. |

Do not delete the whole `.codex/` directory: it may contain project-owned
agents, skills, MCP configuration, and hooks.

## Verification

Maintainers should run:

```bash
node scripts/ci/validate-distribution.js
node scripts/ci/validate-openai-metadata.js
bin/dhpk distribution codex-native verify --json
node tests/documentation-platform-parity.test.js
node tests/run-all.js
```

Expected topology is the inventory-owned canonical package count, 31 modules,
and the inventory-owned Codex project/native entries (invokable skills plus
internal transport and dispatch-context runtimes), with relative symlinks only
in module/Codex projections and no symlinks in the native package. The nine
MCP capability identities above are ledger rows only and are excluded from all
active counts.

## Rollback

Before migration, commit or snapshot `.codex/` and its receipt. If migration
reports a collision, do not force deletion: restore the snapshot or resolve the
specific user-owned destination, then rerun `--migrate --update`. To leave dhpk
project sync, run `--uninstall`; it preserves modified and unrelated entries.

If a post-migration Codex capability regresses, pin the last compatible `0.51.0`
release with its MCP grant intact. Do not reintroduce a hidden MCP fallback or
recreate a retired identity in the current release.

The canonical source and generated native package must never be edited in
parallel. Edit `skills/<public-name>/`, regenerate the native package, validate, and
commit both the source and generated artifact together.
