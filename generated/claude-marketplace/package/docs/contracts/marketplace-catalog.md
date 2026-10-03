# Marketplace catalog classification

This accepted catalog maps each active stable ID to its publication kind, owner,
selection, current distribution surfaces, provisional license classification,
and recorded test-evidence state. `manifests/marketplace-selection.json` is the
machine-readable copy of the ID, authority, kind, owner, and selection columns;
`scripts/lib/marketplace-selection.js` compiles it against the distribution
inventory and fails closed on any drift. Change both together.

## Naming decision

On 2026-10-02 the user decided to keep every current inventory `name`. There
is no broader rename, the six IDs whose slug differs from their `name` stay as
they are, and unprefixed names do not gain a `dhpk-` prefix. Public names are
the inventory `name`. No selected name may be a runtime alias (the `legacy`,
`renamed`, and `retired` aliases in the usage catalog's `runtimeIndex`).

## Publication shape

Only the 15 common entries are public listings. Each common branch, reference,
or internal skill is bundled inside its entry owner when the package is built;
it is not a separate listing. Host-only rows keep a separate identity on the
surfaces listed in the inventory. Withdrawn rows are never published.

## Classification rules

- `entry` rows own themselves. `branch`, `reference`, and `internal` rows must
  name an `entry` owner.
- `common` rows belong to the shared catalog. `host-only` rows retain a separate
  selection identity for each supported Host surface and remain available on
  the surfaces listed in the inventory.
- `withdrawn` rows have no selection and are excluded from dhpk publication.
  The six GitNexus rows are owned upstream; any partial behavior handoff is
  recorded in the owner column.
- `authority` preserves the purpose decision. A child must not receive greater
  authority than its entry owner.
- The test-evidence column is derived from the disposition ledger
  (`compileDispositionLedger` in `scripts/lib/marketplace-selection.js`). A
  skill that ships scripts must trace to at least one test file, or the ledger
  fails. A guidance-only skill has no scripts and needs no behavior test.
  Runtime, package, and licensing evidence are separate acceptance items.
- The version condition of each ID is its inventory `profiles` without `core`:
  an empty condition means the skill is always available, otherwise the named
  module must be enabled.

The accepted catalog contains 84 IDs: 15 common entries, 21 common branches,
25 common references, 13 Host-only entries, 2 Host-only internal skills, and 8
withdrawn skills (6 owned upstream by GitNexus, and `agent-architecture-audit`
and `skill-forge`, excluded on 2026-10-03 for third-party text overlap).

## Accepted classifications

| ID | authority | kind | owner | selection | 現有 surfaces | license | 測試證據 | 備註／待決 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fastapi-pro` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `ios-platform` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `js-lint-config` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `js-static-check-strategy` | read-only | reference | `flow-drive` | common | claude-module, codex-sync, codex-native, cursor-sync | first-party | script：`skill-local-tool-fixtures.js`、`frontmatter.test.js`、`write-handoff.test.js` |  |
| `laravel` | guidance-only | branch | `flow-drive` | common | claude-core | first-party | script：`skill-local-tool-fixtures.js`、`activate-modules.test.js`、`capability-bundle-selection.test.js` 等 10 個 | family；selectors 由 inventory 宣告 |
| `library-dual-testsuite-map` | guidance-only | reference | `tdd` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `matrix-cell-onboard` | workspace-write | branch | `flow-drive` | common | claude-module, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `openspec-artifact-guard` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） | OpenSpec optional adapter |
| `nextjs-15-5-notes` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `nextjs-16-notes` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `php-pro` | read-only | branch | `flow-drive` | common | claude-module, codex-sync, codex-native | first-party | guidance-only（無腳本，不需行為測試） | 既有 runtime router |
| `php-modern-pro` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `php-8x-features` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `phpunit` | guidance-only | branch | `tdd` | common | claude-core | first-party | script：`skill-local-tool-fixtures.js`、`distribution-inventory-validate.test.js`、`frontmatter.test.js` 等 5 個 | family；selectors 由 inventory 宣告 |
| `legacy-code-characterization` | workspace-write | branch | `tdd` | common | claude-module, codex-sync, codex-native | first-party | guidance-only（無腳本，不需行為測試） |  |
| `pytest-async` | guidance-only | reference | `tdd` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `python-pro` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `python-static-checks` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `react-18-notes` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `react-19-notes` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `swift-test-strategy` | guidance-only | reference | `tdd` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `swift-language` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `swiftui-architecture` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `vue-2-notes` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `ios-icon-gen` | guidance-only | branch | `flow-drive` | common | claude-module | first-party | script：`skill-remaining-entry-fixtures.js`、`frontmatter.test.js` |  |
| `xcode-build-tooling` | guidance-only | reference | `flow-drive` | common | claude-module | first-party | guidance-only（無腳本，不需行為測試） |  |
| `php56-yii-dev` | workspace-write | branch | `flow-drive` | common | claude-module, codex-sync, codex-native | first-party | guidance-only（無腳本，不需行為測試） |  |
| `yii1-security-audit` | read-only | branch | `change-verdict` | common | claude-module, codex-sync, codex-native | first-party | guidance-only（無腳本，不需行為測試） |  |
| `flow-guide` | delegate | entry | `flow-guide` | common | claude-core, cursor-sync, codex-sync, codex-native | first-party | script：`skill-flow-entry-fixtures.js`、`skill-flow-family-fixtures.js`、`skill-goal-runtime-fixtures.js` 等 39 個 |  |
| `agent-architecture-audit` | guidance-only | withdrawn | — | —（withdrawn 無 selection） | claude-core, cursor-sync | excluded | withdrawn（不發布） | 2026-10-03 使用者決定排除：與第三方 ECC（MIT）大量逐字重疊且未保留聲明 |
| `agy-fast-worker` | guidance-only | entry | `agy-fast-worker` | host-only | claude-core, cursor-sync | first-party | script：`skill-bridge-family-fixtures.js`、`cli-dispatch-launcher.test.js`、`documentation-platform-parity.test.js` 等 6 個 | CLI 委派 |
| `code-trace` | read-only | entry | `code-trace` | common | claude-core, cursor-sync, codex-sync, codex-native | first-party | guidance-only（無腳本，不需行為測試） |  |
| `cli-dispatch-context` | transport-internal | internal | `codex-bridge` | host-only | claude-core, claude-module, codex-sync, codex-native, agent-plugin, cursor-plugin, cursor-sync, agy-plugin | first-party | script：`skill-bridge-family-fixtures.js`、`cli-dispatch-launcher.test.js`、`cli-role-resolver.test.js` 等 5 個 | transport-internal |
| `cli-transport` | transport-internal | internal | `codex-bridge` | host-only | claude-core, claude-module, codex-sync, codex-native, agent-plugin, cursor-plugin, cursor-sync, agy-plugin | first-party | script：`skill-bridge-family-fixtures.js`、`cli-dispatch-launcher.test.js`、`codex-native-package-validate.test.js` 等 8 個 | transport-internal |
| `codex-bridge` | guidance-only | entry | `codex-bridge` | host-only | claude-core, cursor-sync | first-party | script：`skill-bridge-family-fixtures.js`、`cli-dispatch-launcher.test.js`、`codex-runtime-contract.test.js` 等 8 個 | CLI 委派 |
| `change-verdict` | read-only | entry | `change-verdict` | common | claude-core, cursor-sync | first-party | script：`skill-audit-family-fixtures.js`、`skill-remaining-entry-fixtures.js`、`capability-bundle-selection.test.js` 等 11 個 |  |
| `flow-drive` | workspace-write | entry | `flow-drive` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | script：`skill-flow-entry-fixtures.js`、`skill-flow-family-fixtures.js`、`capability-bundle-selection.test.js` 等 22 個 |  |
| `composer-package-hygiene` | guidance-only | reference | `change-verdict` | common | claude-core, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `skill-forge` | guidance-only | withdrawn | — | —（withdrawn 無 selection） | claude-core, cursor-sync | excluded | withdrawn（不發布） | 2026-10-03 使用者決定排除：參考文件與第三方 ECC（MIT）重疊且未保留聲明 |
| `deploy-list` | guidance-only | branch | `release-creator` | common | claude-core, cursor-sync | first-party | script：`skill-remaining-entry-fixtures.js`、`dhpk-do-portable.test.js`、`userpromptsubmit-skill-hint.test.js` |  |
| `feature-verify` | guidance-only | branch | `repo-verify` | common | claude-core, cursor-sync | first-party | script：`skill-remaining-entry-fixtures.js`、`api-exec.test.js`、`health-probe.test.js` 等 4 個 |  |
| `git-smart-commit` | git-write | entry | `git-smart-commit` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | git-write；使用者決定保留獨立入口 |
| `gitnexus-cli` | external-package | withdrawn | — | —（withdrawn 無 selection） | claude-core, cursor-sync | excluded | withdrawn（不發布） | 全面排除（2026-10-01），屬撤回上游套件：無 dhpk successor；上游 GitNexus 自行提供 CLI 技能 |
| `gitnexus-debugging` | external-package | withdrawn | `code-trace` | —（withdrawn 無 selection） | claude-core, cursor-sync | excluded | withdrawn（不發布） | 全面排除（2026-10-01），屬撤回上游套件：追查部分由 `code-trace` 承接 |
| `gitnexus-exploring` | external-package | withdrawn | `code-trace` | —（withdrawn 無 selection） | claude-core, cursor-sync | excluded | withdrawn（不發布） | 全面排除（2026-10-01），屬撤回上游套件：追查部分由 `code-trace` 承接 |
| `gitnexus-guide` | external-package | withdrawn | — | —（withdrawn 無 selection） | claude-core, cursor-sync | excluded | withdrawn（不發布） | 全面排除（2026-10-01），屬撤回上游套件：無 dhpk successor；上游 GitNexus 自行提供參考技能 |
| `gitnexus-impact-analysis` | external-package | withdrawn | `code-trace` | —（withdrawn 無 selection） | claude-core, cursor-sync | excluded | withdrawn（不發布） | 全面排除（2026-10-01），屬撤回上游套件：影響分析部分由 `code-trace` 承接 |
| `gitnexus-refactoring` | external-package | withdrawn | — | —（withdrawn 無 selection） | claude-core, cursor-sync | excluded | withdrawn（不發布） | 全面排除（2026-10-01），屬撤回上游套件：無 dhpk successor；改名／重構改用可選的外部 GitNexus，dhpk 寫入流程為 `flow-drive` |
| `issue-analyze` | guidance-only | branch | `proposal-analyze` | common | claude-core, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `laravel-package-author` | guidance-only | reference | `flow-drive` | common | claude-core, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `laravel-testbench-matrix` | guidance-only | reference | `tdd` | common | claude-core, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `opsx-apply-goal` | guidance-only | entry | `opsx-apply-goal` | host-only | claude-core, cursor-sync | first-party | script：`opsx-goal-fixtures.js`、`skill-goal-runtime-fixtures.js`、`dhpk-do-portable.test.js` 等 8 個 | OpenSpec／resume |
| `opsx-load-context` | read-only | entry | `opsx-load-context` | host-only | claude-core, codex-sync, codex-native, cursor-sync | first-party | script：`skill-resume-family-fixtures.js`、`extract-compact.test.js`、`reference-route-policy.test.js` 等 6 個 | OpenSpec／resume |
| `opsx-post-obs` | delegate | entry | `opsx-post-obs` | host-only | claude-core, codex-sync, codex-native, cursor-sync | first-party | script：`skill-resume-family-fixtures.js`、`post-obs.test.js`、`reference-route-policy.test.js` 等 5 個 | claude-mem |
| `polyfill-version-matrix-audit` | guidance-only | reference | `change-verdict` | common | claude-core, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `project-audit` | guidance-only | branch | `change-verdict` | common | claude-core, cursor-sync | first-party | script：`skill-audit-family-fixtures.js`、`dhpk-do-portable.test.js`、`skill-runtime-path-contract.test.js` |  |
| `project-setup` | guidance-only | entry | `project-setup` | host-only | claude-core, cursor-sync | first-party | script：`skill-setup-family-fixtures.js`、`skill-setup-family-isolation.test.js`、`symlink-write-guidance.test.js` 等 4 個 | setup 類 |
| `prompt-optimize` | guidance-only | entry | `prompt-optimize` | host-only | claude-core, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | 模型專屬 |
| `release-creator` | external-write | entry | `release-creator` | common | claude-core, cursor-sync, codex-sync, codex-native | first-party | script：`dhpk-do-portable.test.js`、`invocation-precedence.test.js`、`release-runner.test.js` 等 6 個 | external-write；使用者決定保留獨立入口 |
| `repo-intake` | guidance-only | branch | `code-trace` | common | claude-core, cursor-sync | first-party | script：`skill-audit-family-fixtures.js`、`run-skill.test.js`、`skill-runtime-path-contract.test.js` |  |
| `session-usage-audit` | guidance-only | entry | `session-usage-audit` | host-only | claude-core, cursor-sync | first-party | script：`skill-remaining-entry-fixtures.js`、`session-audit-integrity-fixtures.test.js`、`session-usage-audit.test.js` | 讀 Host transcript |
| `skill-scope` | delegate | entry | `skill-scope` | host-only | claude-core, codex-sync, codex-native, cursor-sync | first-party | script：`skill-remaining-entry-fixtures.js`、`distribution-inventory-validate.test.js`、`gen-cursor-sync.test.js` 等 7 個 | 技能治理 |
| `software-architecture` | guidance-only | reference | `proposal-analyze` | common | claude-core, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `tdd` | workspace-write | entry | `tdd` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `harness-govern` | external-write | entry | `harness-govern` | host-only | claude-core, codex-sync, codex-native, cursor-sync | first-party | script：`install-codex-skills-fixtures.js`、`skill-remaining-entry-fixtures.js`、`agy-plugin-install.test.js` 等 17 個 | external-write；harness 維運 |
| `create-pr` | external-write | entry | `create-pr` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | external-write；使用者決定保留獨立入口 |
| `git-worktree` | git-write | entry | `git-worktree` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | git-write；使用者決定保留獨立入口 |
| `merge-prep` | read-only | branch | `create-pr` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | 使用者確認 |
| `pr-summary` | read-only | branch | `create-pr` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `proposal-analyze` | workspace-write | entry | `proposal-analyze` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | 第八候選；需補待決事項與確認 handoff（3.6） |
| `project-brief` | workspace-write | branch | `proposal-analyze` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `doc-refactor` | workspace-write | branch | `update-docs` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `update-docs` | workspace-write | entry | `update-docs` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `update-codemaps` | workspace-write | branch | `update-docs` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `precommit` | workspace-write | entry | `precommit` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | script：`skill-flow-entry-fixtures.js`、`skill-pilot-fixtures.js`、`dhpk-do-portable.test.js` 等 6 個 | 獨立 common 入口（使用者確認） |
| `dep-audit` | workspace-write | entry | `dep-audit` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | workspace-write；原列 change-verdict branch 會把寫入權併入唯讀 owner（review-1 HIGH），改為獨立入口 |
| `repo-verify` | read-only | entry | `repo-verify` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | script：`skill-pilot-fixtures.js`、`install-assets.test.js`、`precommit-runner.test.js` 等 5 個 |  |
| `code-simplify` | workspace-write | branch | `flow-drive` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） |  |
| `harness-audit` | read-only | entry | `harness-audit` | host-only | claude-core, codex-sync, codex-native, cursor-sync | first-party | script：`skill-audit-family-fixtures.js`、`harness-audit.test.js`、`install-assets.test.js` 等 4 個 | Host-only（使用者確認）；Codex 經 Codex Host-only selection |
| `review-pending` | delegate | branch | `flow-drive` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | delegate；改掛 flow-drive 的審查 handoff，避免掛在唯讀 owner 下 |
| `spec-mine` | workspace-write | branch | `proposal-analyze` | common | claude-core, codex-sync, codex-native, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | 使用者確認；OpenSpec 為 optional adapter |
| `harness-setup` | workspace-write | entry | `harness-setup` | host-only | claude-core, cursor-sync | first-party | script：`skill-setup-family-fixtures.js`、`skill-setup-family-isolation.test.js`、`symlink-write-guidance.test.js` 等 4 個 | setup 類 |
| `opsx-apply-resume` | workspace-write | entry | `opsx-apply-resume` | host-only | claude-core, cursor-sync | first-party | script：`skill-resume-family-fixtures.js`、`install-assets.test.js`、`reference-route-policy.test.js` 等 6 個 | OpenSpec／resume |
| `ui-ux-verify` | workspace-write | entry | `ui-ux-verify` | common | claude-core, cursor-sync | first-party | guidance-only（無腳本，不需行為測試） | 能力條件式 common 入口（使用者確認） |
