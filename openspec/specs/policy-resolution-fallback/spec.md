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
`rules/execution-policy.md` SHALL state, near its top (alongside or extending the existing "Project overrides" note), the explicit resolution order for any consumer resolving a reference to this file: project `.claude/rules/execution-policy.md` first (if present, as a delta overlay), else `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (plugin SSOT).

#### Scenario: Resolution order stated at the top of the file
- **WHEN** the first section of `rules/execution-policy.md` is read
- **THEN** it SHALL explicitly state the two-tier resolution order (project override first, plugin default fallback second), not merely note that project overrides are encouraged

### Requirement: Reference-integrity guard forbids bare execution-policy.md references
The reference-integrity guard (`scripts/ci/validate-references.js`, exercised by `tests/reference-integrity.test.js`, or `scripts/validate/validate-harness.sh`) SHALL flag any `.md` file under the plugin source tree that references `.claude/rules/execution-policy.md` without also stating the `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` fallback path in the same reference (or the same References/Rule-sources block), so this defect class cannot silently regress.

#### Scenario: New bare reference is caught
- **WHEN** a new or edited `.md` file under the plugin source tree contains the literal string `.claude/rules/execution-policy.md` with no accompanying `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` fallback in the same reference block
- **THEN** the reference-integrity check SHALL report a finding for that file, causing `node tests/run-all.js` (or the dedicated reference-integrity test) to fail

#### Scenario: Qualified dual-path reference passes clean
- **WHEN** a `.md` file references `execution-policy.md` using the dual-path fallback wording (project path plus `${CLAUDE_PLUGIN_ROOT}` fallback, as modeled in `skills/harness-fill/SKILL.md`)
- **THEN** the reference-integrity check SHALL report zero findings for that reference

#### Scenario: Real tree is clean after the fix
- **WHEN** `node tests/run-all.js` (the reference-integrity suite) is run against the fixed tree
- **THEN** it SHALL report zero findings across the whole repo, including the five call sites identified in this change (`agents/ui-ux-verifier.md`, `agents/harness-reviser.md`, `skills/pr-review/SKILL.md`, `modules/php-5.6/skills/php-pro/SKILL.md`, `skills/execution-checklist/SKILL.md`)
