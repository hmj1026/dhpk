# skill-retirement-migration Specification

## Purpose

Define an alias-free, inventory-owned retirement contract that preserves successor guidance, installation ownership safety, deterministic projections, and explicit rollback behavior.

## Requirements

### Requirement: Retired skills have stable migration identities

Every retired skill SHALL have one non-discovery-visible inventory record containing its former stable ID, former public name, canonical path, prior surfaces, retirement release, reason, rollback pin, and one or more replacement rows. Each replacement row SHALL declare `skill`, `external-skill`, `agent`, `model-default`, or `operator-action` plus an identity or mode when applicable. An `external-skill` replacement SHALL identify an externally owned skill whose contract is not copied into DHPK. An `operator-action` replacement SHALL be guidance only and SHALL NOT be invoked by a resolver, dispatcher, installer, or projection. Retirement records MUST NOT be materialized as skill packages or discovery aliases.

SCF-REQ-008: A higher-priority scoped exception SHALL apply only to the following personal direct-replacement set for `consolidate-self-contained-skill-families`: these identities SHALL be tracked by the complete mapping below rather than classified as release-ledger retirements. They SHALL be removed from active inventory/discovery/usage/resource projections without aliases, shims, compatibility windows, release/rollback ledger records, or public retired announcements. The general release-ledger, diagnostic, and release-rollback requirements SHALL continue to apply to all other retirements and existing historical ledgers. The exception SHALL preserve verifiable identity mapping, successor behavior, family-local required resource closure, consistent inventory/profile/resource/usage projections, existing ownership protections, and unrelated provider/profile selections. A shared source with other consumers SHALL remain intact.

| Replaced stable ID | Successor stable ID |
| --- | --- |
| `opsx-load-context` | `opsx-apply-resume` |
| `opsx-post-obs` | `opsx-apply-resume` |
| `swift-language` | `swift` |
| `swiftui-architecture` | `swift` |
| `swift-test-strategy` | `swift` |
| `ios-platform` | `swift` |
| `xcode-build-tooling` | `swift` |
| `ios-icon-gen` | `swift` |
| `react-18-notes` | `react` |
| `react-19-notes` | `react` |
| `nextjs-15-5-notes` | `nextjs` |
| `nextjs-16-notes` | `nextjs` |
| `python-pro` | `python` |
| `python-static-checks` | `python` |
| `pytest-async` | `python` |
| `fastapi-pro` | `python` |
| `js-lint-config` | `js-static-checks` |
| `js-static-check-strategy` | `js-static-checks` |
| `php-pro` | `php` |
| `php-modern-pro` | `php` |
| `php-8x-features` | `php` |
| `php56-yii-dev` | `yii1` |
| `yii1-security-audit` | `yii1` |
| `review-pending` | `change-verdict` |
| `dep-audit` | `change-verdict` |

#### Scenario: Skill successor is another skill or mode

- **WHEN** a caller resolves a retired Bug, Feature, post-development test, or brainstorm identifier outside the personal direct-replacement set
- **THEN** the diagnostic names the former identity and its inventory-owned successor skill, mode, or agent route without publishing the former package

#### Scenario: Skill retires to model-default behavior

- **WHEN** a caller resolves `dhpk-de-ai-flavor`
- **THEN** the diagnostic identifies an intentional model-default retirement and does not invent a successor skill

#### Scenario: Current wave uses an external or operator replacement

- **WHEN** a caller resolves `tech-spec`, `create-request`, or `op-session`
- **THEN** the diagnostic reports `external-skill` `openspec-propose` guidance for the first two and `operator-action` `onepassword-cli` with mode `signin` for the last, without invoking either replacement

#### Scenario: Personal replacement is delivered

- **WHEN** a mapped personal replacement passes its successor behavior and complete resource/selection checks
- **THEN** its old entry is absent from active discovery/packages without a compatibility alias, public retirement announcement, or required release/rollback ledger entry

#### Scenario: Unrelated historical retirement is reconciled

- **WHEN** reconciliation processes an identity outside this closed personal set
- **THEN** existing release-ledger, diagnostic, receipt-ownership, and rollback requirements remain applicable

#### Scenario: Personal replacement loses resource or profile closure

- **WHEN** a mapped successor lacks a required asset, retains an old active reference, or changes an unrelated selected identity
- **THEN** consolidation validation fails despite the personal lifecycle exception

### Requirement: Retired invocation fails closed with guidance

Dhpk-owned dispatch, helper, package, and installation interfaces that can
intercept a retired stable ID or public name SHALL reject or annotate it with a
stable retirement diagnostic and successor guidance. The same interfaces SHALL
recognize an old public name recorded in the active rename ledger and return a
stable `renamed` diagnostic without treating it as an alias. Unknown
identifiers SHALL remain distinguishable from retired or renamed identifiers.
Direct host Skill invocation bypasses repository-owned seams and SHALL be
documented as unsupported after alias-free retirement.

#### Scenario: Retired ID reaches a dhpk-owned interface

- **WHEN** a dhpk-owned dispatcher, helper, package, or installation interface receives a retired stable ID or public name
- **THEN** it exits non-zero and reports the retirement release, replacement kind, and successor identity or model-default guidance

#### Scenario: Unknown ID reaches a standard dispatcher

- **WHEN** a standard dispatcher receives an identifier absent from both active and retired inventory records
- **THEN** it returns an unknown-identifier diagnostic rather than a retirement diagnostic

#### Scenario: Direct host invocation bypasses dhpk interfaces

- **WHEN** a host attempts to invoke the removed public name without passing through a dhpk-owned seam
- **THEN** documentation allows the host-owned unknown-skill response and points operators to migration documentation rather than requiring an alias

#### Scenario: Active family public name was renamed

- **WHEN** a dhpk-owned seam receives `dhpk-laravel` or `dhpk-phpunit` after the
  0.54.0 cutover
- **THEN** it exits non-zero with a `renamed` diagnostic naming stable ID
  `laravel` or `phpunit` and the new public name, without resolving an alias or
  publishing the old name

### Requirement: Retirement reconciliation preserves unowned work

Upgrade and reconciliation paths SHALL remove a retired installed entry only when the receipt proves dhpk ownership and the observed fingerprint still matches the receipt. Modified, retargeted, or unowned entries MUST remain unchanged and SHALL be reported as conflicts or orphans.

#### Scenario: Owned unchanged retired entry is present

- **WHEN** an installed retired entry is receipt-owned and its observed fingerprint equals the recorded fingerprint
- **THEN** reconciliation removes that entry and updates the receipt without touching unrelated paths

#### Scenario: Retired entry was modified or is unowned

- **WHEN** an installed path for a retired identity is modified, retargeted, or lacks matching ownership evidence
- **THEN** reconciliation preserves the path, reports its ownership classification and fingerprint evidence, and does not claim a clean migration

### Requirement: Successor behavior and route closure precede deletion

Canonical deletion SHALL occur only after each non-model-default successor owns the migrated unique behavior, every live route and reference resolves to an active identity, repository reference validation passes, inventory generation preserves the retirement ledger, projection provenance includes its identity, and generated surfaces contain neither the retired package nor a discovery alias.

#### Scenario: A successor still delegates to a retired skill

- **WHEN** an active skill, command, agent, rule, route table, test, or generated projection still delegates to a retired identity
- **THEN** retirement validation fails and canonical deletion is not accepted

#### Scenario: Retirement closure is complete

- **WHEN** migrated behavior is present under active successors, all live references resolve, and deterministic projections are regenerated
- **THEN** validation accepts the canonical removal and reports the retired identities separately from active counts

### Requirement: Rollback is version pinning rather than hidden aliasing

Rollback for an alias-free retirement SHALL use the last compatible release package and its receipts. The retiring release MUST NOT retain hidden canonical sources or discovery-visible aliases solely for rollback.

#### Scenario: Operator requests rollback

- **WHEN** an operator must restore a retired workflow after installing the retiring release
- **THEN** guidance pins release `0.53.0` and applies its receipt-bound installation path instead of reconstructing an alias in the new `0.54.0` release

### Requirement: Context evidence remains stage-honest

Retirement reporting SHALL distinguish static canonical and discovery-description reductions from installed and live consumer evidence. A reduced inventory or generated package SHALL NOT be reported as observed runtime context savings.

#### Scenario: Static retirement validation passes without a live consumer probe

- **WHEN** canonical counts, description totals, and generated projections pass but no exact-artifact consumer probe ran
- **THEN** the report records structural/package results and leaves runtime evidence as `NOT_RUN`, `UNAVAILABLE`, `NOT_CONFIGURED`, or `BLOCKED`

### Requirement: Capability-family consolidation retires predecessors without aliases

The retirement ledger SHALL record exactly the following 21 approved stable-ID
retirements with their former public name, canonical path, prior surfaces,
retirement release `0.54.0`, reason, rollback pin `0.53.0`, and replacement:

| Retired stable ID | Successor kind | Successor identity and mode or selector | Reason |
|---|---|---|---|
| `laravel-5.4-notes` | `skill` | `laravel`, selector `5.4` | `version-family-alias-removal` |
| `laravel-6-notes` | `skill` | `laravel`, selector `6` | `version-family-alias-removal` |
| `laravel-7-notes` | `skill` | `laravel`, selector `7` | `version-family-alias-removal` |
| `laravel-8-notes` | `skill` | `laravel`, selector `8` | `version-family-alias-removal` |
| `laravel-9-notes` | `skill` | `laravel`, selector `9` | `version-family-alias-removal` |
| `laravel-10-notes` | `skill` | `laravel`, selector `10` | `version-family-alias-removal` |
| `laravel-11-notes` | `skill` | `laravel`, selector `11` | `version-family-alias-removal` |
| `laravel-mix-notes` | `skill` | `laravel`, selector `mix` | `version-family-alias-removal` |
| `phpunit-9-modern` | `skill` | `phpunit`, selector `9` | `version-family-alias-removal` |
| `phpunit-10-notes` | `skill` | `phpunit`, selector `10` | `version-family-alias-removal` |
| `phpunit-11-notes` | `skill` | `phpunit`, selector `11` | `version-family-alias-removal` |
| `claude-health` | `skill` | `harness-govern`, mode `health` | `remaining-capability-family-consolidation` |
| `harness-budget` | `skill` | `harness-govern`, mode `budget` | `remaining-capability-family-consolidation` |
| `harness-fill` | `skill` | `harness-govern`, mode `fill` | `remaining-capability-family-consolidation` |
| `harness-revise` | `skill` | `harness-govern`, mode `revise` | `remaining-capability-family-consolidation` |
| `multi-ai-sync` | `skill` | `harness-govern`, mode `sync` | `remaining-capability-family-consolidation` |
| `agy-commit` | `skill` | `git-smart-commit` | `remaining-capability-family-consolidation` |
| `feasibility-study` | `skill` | `software-architecture`, mode `compare` | `remaining-capability-family-consolidation` |
| `tech-spec` | `external-skill` | `openspec-propose`, action `propose` | `openspec-authoring-consolidation` |
| `create-request` | `external-skill` | `openspec-propose`, action `propose` | `openspec-authoring-consolidation` |
| `op-session` | `operator-action` | `onepassword-cli`, action `signin` | `operator-action-capability-removal` |

No predecessor skill directory, generated alias package, command alias,
routing alias, or discovery entry SHALL remain after the atomic cutover. The
`git-smart-commit` stable ID, public name, canonical path, surface membership,
and behavior SHALL remain unchanged; `agy-commit` migration SHALL NOT retain an
AGY delegation adapter. The command retirement set is exactly `check-skill`,
`create-dev`, `do`, `codex-review`, `codex-review-fast`, `codex-review-branch`,
`codex-review-doc`, `codex-security`, `codex-test-review`, and `review-spec`.

#### Scenario: Current wave identity maps to its declared replacement

- **WHEN** any of the 21 approved predecessor stable IDs is retired
- **THEN** its record contains exactly one replacement row with the declared
  kind and identity or mode above, retirement release `0.54.0`, and rollback pin
  `0.53.0`

#### Scenario: Predecessor maps to a family mode

- **WHEN** a family predecessor from the approved consolidation mapping is
  retired
- **THEN** its retirement record points to exactly one declared family identity
  and mode or selector, and the current wave rollback pin is `0.53.0`

#### Scenario: Compatibility alias is generated

- **WHEN** a projection, installer, command index, or router attempts to emit an
  alias for one of the 21 retired identities
- **THEN** validation fails before publication and reports the predecessor and
  generated path

#### Scenario: Command retirement differs from the approved set

- **WHEN** the change retains one approved command alias or deletes an
  additional command not in the approved set
- **THEN** command validation fails and reports the unexpected retained or
  removed command

#### Scenario: Commit owner remains unchanged

- **WHEN** migration validation compares `git-smart-commit` before and after the
  cutover
- **THEN** `skills/dhpk-git-smart-commit/**`, its stable ID, public name,
  selected surfaces, and commit approval behavior are byte- or
  contract-equivalent, while
  `agy-commit` is absent

### Requirement: External-package identities require a separate lifecycle change

An identity listed in the inventory's external-package registry SHALL NOT be
retired, renamed, consolidated, or used as a successor-family predecessor unless
a separate reviewed change first removes or revises its external ownership
record. An `external-skill` replacement row MAY point to an external skill that
is not an inventory-owned predecessor, but the replacement's contract SHALL
remain external and SHALL NOT be copied into the retired package's successor.

#### Scenario: External identity enters the retirement ledger

- **WHEN** an external-package stable ID also appears as a retirement ID or family predecessor
- **THEN** inventory validation fails and names both the package owner and conflicting lifecycle record

### Requirement: Active family public renames are diagnostic-only

The inventory SHALL maintain a non-retirement `renamed_skill_names` ledger for
active stable IDs whose public names change. The 0.54.0 ledger SHALL contain
exactly these rows: stable ID `laravel`, old public name `dhpk-laravel`, old path
`skills/dhpk-laravel`, new public name `laravel`, new path `skills/laravel`,
rollback pin `0.53.0`; and stable ID `phpunit`, old public name `dhpk-phpunit`,
old path `skills/dhpk-phpunit`, new public name `phpunit`, new path
`skills/phpunit`, rollback pin `0.53.0`. Rename rows MUST NOT be placed in
`legacy_names`, the retirement ledger, or any discovery-visible alias package.

#### Scenario: Active public name is renamed

- **WHEN** the 0.54.0 inventory is generated for `laravel` or `phpunit`
- **THEN** the active stable ID remains unchanged, the new unprefixed public
  name and path are emitted, and the old public name is present only in the
  diagnostic ledger

#### Scenario: Rename is emitted as an alias

- **WHEN** a generator, installer, receipt, or discovery manifest emits
  `dhpk-laravel` or `dhpk-phpunit` as an active alias after cutover
- **THEN** validation fails and reports the rename row and emitted alias

### Requirement: Wave-2 library, documentation, and forwarder identities retire without aliases

REQ-4, REQ-5, REQ-7, REQ-8: The retirement ledger SHALL record exactly the
following approved retirements with former public name, canonical path, prior
surfaces, then-current retirement release explicitly frozen in W0 before
ledger or retirement work, reason, rollback pin `0.66.1`,
and one replacement row. No predecessor skill directory, agent file, generated
alias package, command alias, routing alias, or discovery entry SHALL remain
after cutover. Dhpk-owned dispatch, helper, package, and installation
interfaces that intercept a retired stable ID, public name, or role name SHALL
reject it with a stable retirement diagnostic and successor guidance. Unknown
identifiers SHALL remain distinguishable from retired identifiers. Canonical
deletion SHALL occur only after each successor owns the migrated unique
behavior, every live route and reference resolves to an active identity,
repository reference validation passes, inventory generation preserves the
retirement ledger, and generated surfaces contain neither the retired package
nor a discovery alias. Rollback SHALL pin release `0.66.1` rather than restore
an alias. This set SHALL NOT alter the historical 21-ID `0.54.0` ledger or
the SCF 25-ID personal-replacement mapping.

Skill replacements:

| Retired stable ID | Successor kind | Successor identity and mode | Reason |
|---|---|---|---|
| `laravel-package-author` | `skill` | `library-author`, mode `author` | `library-doc-family-consolidation` |
| `laravel-testbench-matrix` | `skill` | `library-author`, mode `testbench` | `library-doc-family-consolidation` |
| `composer-package-hygiene` | `skill` | `library-author`, mode `composer` | `library-doc-family-consolidation` |
| `polyfill-version-matrix-audit` | `skill` | `library-author`, mode `polyfill-audit` | `library-doc-family-consolidation` |
| `library-dual-testsuite-map` | `skill` | `library-author`, mode `suite-map` | `library-doc-family-consolidation` |
| `matrix-cell-onboard` | `skill` | `library-author`, mode `cell-onboard` | `library-doc-family-consolidation` |
| `update-docs` | `skill` | `doc-maintain`, mode `update` | `library-doc-family-consolidation` |
| `update-codemaps` | `skill` | `doc-maintain`, mode `codemap` | `library-doc-family-consolidation` |
| `doc-refactor` | `skill` | `doc-maintain`, mode `refactor` | `library-doc-family-consolidation` |

Agent replacements:

| Retired identity | Successor kind | Successor identity | Reason |
|---|---|---|---|
| `agy-fast-worker` | `agent` | `agy-worker` | `elapsed-one-release-forwarder` |
| `codex-fast-worker` | `agent` | `codex-worker` | `elapsed-one-release-forwarder` |
| `codex-deep-reasoner` | `agent` | `codex-reasoner` | `elapsed-one-release-forwarder` |

Live-route closure before deletion includes inventory, install profiles,
marketplace selection, command-skill dispositions, skill-directory coverage,
skill-resources and skill-resource-copies, profile-projection-sets, skills
index, route-table, generated flow-guide usage catalog, generated provenance
embeddings, and pointers in `polyfill-reviewer`, `version-matrix-impact-reviewer`,
and `doc-updater`. Regeneration of `generated/` SHALL follow the plugin
development clean-checkout preflight. Unrelated retirement ledgers, external
packages, receipt-owned conflicts, and keep-separate identities SHALL remain
intact. Static catalog reduction SHALL NOT be reported as observed runtime
savings.

#### Scenario: Retired skill ID reaches a dhpk-owned interface

- **WHEN** a dhpk-owned dispatcher, helper, package, or installation interface
  receives `dhpk-laravel-package-author` or `update-docs` after cutover
- **THEN** it exits non-zero and reports the retirement release, replacement
  kind `skill`, and successor family identity plus mode, without publishing
  the former package

#### Scenario: Retired forwarder name reaches a dhpk-owned interface

- **WHEN** a dhpk-owned role resolver or dispatcher receives `agy-fast-worker`,
  `codex-fast-worker`, or `codex-deep-reasoner` after cutover
- **THEN** it exits non-zero with a retirement diagnostic naming successor
  `agy-worker`, `codex-worker`, or `codex-reasoner` and does not dispatch

#### Scenario: A successor still delegates to a retired identity

- **WHEN** an active skill, command, agent, rule, route table, test, or
  generated projection still delegates to a retired wave-2 identity
- **THEN** retirement validation fails and canonical deletion is not accepted

#### Scenario: Compatibility alias is generated

- **WHEN** a projection, installer, command index, or router attempts to emit
  an alias for one of the retired wave-2 identities
- **THEN** validation fails before publication and reports the predecessor and
  generated path

#### Scenario: Operator requests rollback

- **WHEN** an operator must restore a retired wave-2 workflow after installing
  the retiring release
- **THEN** guidance pins release `0.66.1` and applies its receipt-bound
  installation path instead of reconstructing an alias

#### Scenario: SCF mapping is altered by this retirement

- **WHEN** reconciliation adds, omits, or remaps a predecessor from the SCF
  25-ID set
- **THEN** validation fails and this wave's retirement is not accepted
