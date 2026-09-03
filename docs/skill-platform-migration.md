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
| Canonical source | 85 flat packages at `skills/<public-name>/` |
| Public identity | The six capability families use unprefixed names; all other first-party names remain `dhpk-*` |
| Inventory SSOT | `manifests/distribution-inventory.json` schema v2 |
| Module projection | 37 relative symlinks under `modules/*/skills/` |
| Codex project projection | 18 relative symlinks under `codex/skills/` (16 invokable plus internal transport and dispatch-context runtimes) |
| Codex native package | 18 physical packages under `plugins/dhpk/skills/`; zero symlinks |
| Codex project receipt | `.codex/.dhpk-installed.json` schema v3 |
| Default hooks | `PreToolUse`, `PostToolUse`, `SessionStart`, `SubagentStop` |

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
| Codex main-flow entry | `$flow-drive --mode route|implement <task>` after discovery | `$flow-drive --mode implement fix the login redirect` |

Codex built-in commands (`/hooks`, `/agent`) are not dhpk custom `/dhpk:*`
commands. The explicit `flow-drive` family is the Codex implementation entry;
`flow-guide` remains the implicit classification and gate owner. Availability
evidence is a receipt-owned `.codex/skills/flow-drive` that resolves as
`$flow-drive`; `codex plugin list` is management evidence only. If the family
is not discovered, instruction routing and explicit `/opsx:*` OpenSpec
commands remain available — do not claim `/dhpk:do` is callable in Codex.

The `dhpk` prefix remains part of the Claude plugin namespace. The six reborn
family names are intentionally unprefixed so users select a task-shaped
capability without learning predecessor implementation names.

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

## Consolidated capability families

The 22 first-party discovery identities retired in 0.53.0 are addressed by six
mode-shaped families. The family name is the public identity; the predecessor
stable ID remains only in the retirement ledger below.

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
command. Codex uses the explicit `$flow-drive` family for task routing and has
no `/dhpk:do` command. Overlapping workflows use these primary entry points:

- `$flow-drive --mode route|implement <task>` for Codex task routing or implementation.
- `/dhpk:flow-drive --mode route|implement <task>` on Claude when explicitly invoked.
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
`/dhpk:setup`, `/dhpk:flow-guide`, and `/dhpk:harness-audit` resolve. Project-local
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
