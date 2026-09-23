# Portable command workflows

Codex invokes installed Skills with `$<public-name>`. Claude's existing
`/dhpk:<command>` entry points forward to the same canonical procedures.
Use `$flow-guide help` to discover the installed grammar; package presence and
runtime availability are separate evidence.

## Names and migration

| Existing entry | Portable Skill |
| --- | --- |
| `deep-analyze` | `$proposal-analyze` |
| `verify` | `$repo-verify` |
| `simplify` | `$code-simplify` |
| `smart-commit` | `$git-smart-commit` |
| `create-release` | `$release-creator` |
| `matrix-cell-onboard` | `$matrix-cell-onboard` |
| `codex-test-gen` | `$tdd-workflow test-generation <target>` |
| `check-coverage` | `$change-verdict --mode tests --coverage` |
| `precommit-fast` | `$precommit --fast` |
| `ts-check-status` | `$js-static-check-strategy status --path <directory>` |

The other generic command workflows use the command's name directly:
`create-pr`, `git-worktree`, `merge-prep`, `pr-summary`, `project-brief`,
`doc-refactor`, `update-docs`, `update-codemaps`, `precommit`, `dep-audit`,
`harness-audit`, `review-pending`, and `spec-mine`. Existing `flow-guide`,
`flow-drive`, and `harness-govern` keep their names.

The five existing `dhpk-` names for commit, release, matrix onboarding, TDD,
and JS static-check guidance migrate to the names above. Their stable IDs and
capability identities do not change. Other prefixed Skills are unaffected.
The rename ledger supplies diagnostics; it does not publish duplicate aliases.

The purpose ledger records new Skills as ADR-backed additions. The historical
65-Skill baseline stays unchanged; current decisions cover all 84 Skills.

### Runner and script migration

These exclusive script paths are removed as a breaking cutover; no
compatibility shims are published:

| Removed path | Owning Skill directory |
| --- | --- |
| `scripts/precommit-runner.js` | `skills/precommit/scripts/` |
| `scripts/verify-runner.js` | `skills/repo-verify/scripts/` |
| `scripts/harness-audit.js` | `skills/harness-audit/scripts/` |
| `scripts/opsx-apply-resume/*.sh` | `skills/opsx-apply-resume/scripts/` |

The setup installer copies complete local trees to
`.claude/dhpk/skills/precommit/scripts/`,
`.claude/dhpk/skills/repo-verify/scripts/`, and
`.claude/dhpk/skills/harness-audit/scripts/`, including each runner's adjacent
`lib/runner-utils.js` helper where one exists. A Skill resolves its helpers from
its own directory automatically, so it does not need an ambient dhpk checkout.
The resume helpers are used from the installed `opsx-apply-resume` Skill; the
setup installer no longer copies them and does not remove copies left under
`.claude/dhpk/scripts/opsx-apply-resume/` by an older install. Delete those
copies manually once nothing of yours calls them.

The setup installer has no ownership receipt for the former root files. It
preserves any existing legacy runner file, reports the exact path and manual
reconciliation action, and stops preflight with exit 3 even when `--force` is
present. Real installation requires Python 3 for the writer's file-descriptor
based physical writes and stops before target mutation with exit 2 when it is
unavailable; `--dry-run` remains available without Python 3.

To migrate a receipt-owned installation, use the separate receipt-aware Codex
route, `scripts/hooks/install-codex-skills.sh`, rather than the no-receipt setup
copy above. That route permits migration only of unchanged managed entries.
Edited or unowned entries and third-party name collisions are preserved and
reported. Resolve the reported conflict before retrying. Rollback uses the
previous release and the same receipt-aware route, not manual directory
replacement.

## Self-contained Skill directories

Each canonical Skill directory is its complete distribution unit: `SKILL.md`,
`references/`, `scripts/`, and any other files it needs live inside it.

- **Breaking:** the per-Skill `skill-package.json` descriptors are removed. No
  publisher or installer reads a descriptor, injects files from outside a
  Skill directory, or installs a peer Skill implicitly.
- Helpers shared by several Skills are copied into each Skill that needs them.
  dhpk maintainers keep those copies in sync with a repository-only tool;
  consumers never run a synchronization or build step.
- Claude profile bundles and the AGY package now publish each selected Skill's
  full directory. Previously some Skills shipped only `SKILL.md`.
- New package receipts omit `skillPackageClosure`. Older receipts that still
  carry it remain valid.
- Upgrading a receipt-owned Codex install removes an unchanged descriptor or
  helper that the new Skill no longer ships. Edited or unowned files are kept
  and reported.
- Host support is unchanged. Delegating to another Skill is optional. Required
  tools, Host capabilities, and independent reviews still apply. When a
  required review is unavailable, the result is `BLOCKED`.

These statements describe the specified and fixture-tested behavior. Consumer
installs and Host probes for the published packages are recorded separately
after publication.

## Execution boundaries

- `repo-verify` runs checks; `precommit` may run format fixes.
- `dep-audit` changes dependencies only with the requested fix option.
- `create-pr` previews by default; release and Git operations retain their
  explicit execution and authorization boundaries.
- `review-pending` returns reviewer evidence; gate clearance remains a separate
  runtime operation.
- `harness-setup`, `opsx-apply-resume`, and `ui-ux-verify` have Host-specific
  adapters. Their Codex publication requires consumer evidence; missing tools
  or configuration produce an explicit unavailable or blocked result.

Required runners and references are package resources. A consumer does not
need an ambient dhpk checkout for a supported portable workflow. A missing
optional provider is reported rather than treated as a successful invocation.
