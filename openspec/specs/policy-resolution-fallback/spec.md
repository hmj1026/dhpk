# policy-resolution-fallback Specification

## Purpose

Define the two-tier resolution and integrity rules for references to the
project override and plugin-shipped execution policy.

## Requirements

### Requirement: execution-policy.md references state the project-override / plugin-default fallback mechanism

Every reference to `execution-policy.md` from within an agent, skill, or command definition SHALL state the two-tier resolution mechanism — project `.claude/rules/execution-policy.md` takes precedence when present (as a delta overlay), otherwise resolve to `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (the plugin SSOT) — rather than a bare, single, environment-assuming path.

#### Scenario: ui-ux-verifier agent reference is dual-path

- **WHEN** `agents/ui-ux-verifier.md`'s References section is inspected
- **THEN** its `execution-policy.md` reference SHALL state both the project-local path and the `${CLAUDE_PLUGIN_ROOT}` fallback, with the precedence rule stated or clearly implied

#### Scenario: harness-reviser agent reference is dual-path

- **WHEN** `agents/harness-reviser.md`'s sentinel-contract reference is inspected
- **THEN** its `execution-policy.md` reference SHALL state both the project-local path and the `${CLAUDE_PLUGIN_ROOT}` fallback

#### Scenario: pr-review skill references are dual-path

- **WHEN** `skills/pr-review/SKILL.md`'s "Rule sources" section is inspected
- **THEN** both `execution-policy.md` references SHALL state the project-local path and the `${CLAUDE_PLUGIN_ROOT}` fallback

#### Scenario: php-pro module skill reference is dual-path

- **WHEN** `modules/php-5.6/skills/php-pro/SKILL.md`'s "Reference Projects & Rules" section is inspected
- **THEN** its `execution-policy.md` reference SHALL state both the project-local path and the `${CLAUDE_PLUGIN_ROOT}` fallback

#### Scenario: execution-checklist skill reference is dual-path

- **WHEN** `skills/execution-checklist/SKILL.md`'s source note is inspected
- **THEN** its `execution-policy.md` reference SHALL state both the project-local path and the `${CLAUDE_PLUGIN_ROOT}` fallback, rather than only softening the wording to "typically"

### Requirement: rules/execution-policy.md documents its own resolution order

`rules/execution-policy.md` SHALL state, near its top, the `POLICY_BUNDLE_ROOT`
self-locating resolution mechanism — and so SHALL any execution-bundle mirror
of it shipped inside a Skill's
`references/execution-bundle/rules/execution-policy.md` (per
`skill-directory-self-containment`): resolve the real path of the selected
`<bundle-root>/rules/execution-policy.md`, derive `POLICY_BUNDLE_ROOT` as the
real parent of that file's containing `rules` directory (the repository root
for the canonical policy, or the Skill's `references/execution-bundle`
directory for a raw Skill), and resolve required references beneath that
base. It SHALL explicitly state that the base is not inferred from an active
Skill, environment variable, checkout search, or fallback chain —
superseding the prior two-tier project-override / `${CLAUDE_PLUGIN_ROOT}`
fallback description for these self-locating files specifically. The
"Project overrides" note (a project's own short delta file) remains a
separate, unrelated concept and MAY still mention the bare project-local
path without restating this file's own resolution mechanism.

#### Scenario: Resolution order stated at the top of the file

- **WHEN** the first section of `rules/execution-policy.md` (or one of its
  execution-bundle mirrors) is read
- **THEN** it SHALL explicitly state the `POLICY_BUNDLE_ROOT` self-locating
  resolution mechanism and the prohibition on inferring the base from an
  environment variable, checkout search, or fallback chain

### Requirement: Reference-integrity guard forbids bare execution-policy.md references

The reference-integrity guard SHALL flag any `.md` file under the
plugin source tree that references `.claude/rules/execution-policy.md`
without also stating the `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`
fallback path in the same reference (or the same References/Rule-sources
block), so this defect class cannot silently regress — **except** for the
four execution-bundle self-locating files governed by the requirement above
(`rules/execution-policy.md` and its `dhpk-opsx-apply-goal` / `flow-drive` /
`flow-guide` mirrors under `references/execution-bundle/rules/execution-policy.md`).
For those four files specifically, the guard SHALL instead flag any
reappearance of the legacy `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`
fallback phrase, since the `POLICY_BUNDLE_ROOT` mechanism explicitly forbids
a fallback chain and its reintroduction is itself a contract regression. All
other consumer references (agents, skills, and commands outside these four
files) remain subject to the unmodified dual-path requirement. This guard is
implemented by `scripts/ci/validate-references.js`, exercised by
`tests/reference-integrity.test.js`, and also runs as part of
`scripts/validate/validate-harness.sh`.

#### Scenario: New bare reference is caught

- **WHEN** a new or edited `.md` file under the plugin source tree, other
  than the four execution-bundle self-locating files, contains the literal
  string `.claude/rules/execution-policy.md` with no accompanying
  `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` fallback in the same
  reference block
- **THEN** the reference-integrity check SHALL report a finding for that
  file, causing `node tests/run-all.js` (or the dedicated
  reference-integrity test) to fail

#### Scenario: Qualified dual-path reference passes clean

- **WHEN** a `.md` file outside the four execution-bundle self-locating
  files references `execution-policy.md` using the dual-path fallback
  wording (project path plus `${CLAUDE_PLUGIN_ROOT}` fallback, as modeled
  in `skills/harness-fill/SKILL.md`)
- **THEN** the reference-integrity check SHALL report zero findings for
  that reference

#### Scenario: Execution-bundle self-locating file needs no dual-path fallback

- **WHEN** `rules/execution-policy.md` or one of its three execution-bundle
  mirrors mentions the bare project-local path `.claude/rules/execution-policy.md`
  (e.g. in its "Project overrides" note) without the
  `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` fallback phrase
- **THEN** the reference-integrity check SHALL report zero check-5 findings
  for that file

#### Scenario: Reintroduced legacy fallback in a self-locating file is caught

- **WHEN** one of the four execution-bundle self-locating files is edited
  to reintroduce the literal string
  `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`
- **THEN** the reference-integrity check SHALL report a check-5 finding for
  that file, since the `POLICY_BUNDLE_ROOT` mechanism forbids a fallback
  chain

#### Scenario: Real tree is clean after the fix

- **WHEN** `node tests/run-all.js` (the reference-integrity suite) is run
  against the fixed tree
- **THEN** it SHALL report zero findings across the whole repo, including
  the five legacy call sites identified in the originating change
  (`agents/ui-ux-verifier.md`, `agents/harness-reviser.md`,
  `skills/pr-review/SKILL.md`, `modules/php-5.6/skills/php-pro/SKILL.md`,
  `skills/execution-checklist/SKILL.md`, which remain dual-path) and the
  four execution-bundle self-locating files introduced by
  `self-contained-skill-directories` (which are exempt from the dual-path
  requirement per this delta)
