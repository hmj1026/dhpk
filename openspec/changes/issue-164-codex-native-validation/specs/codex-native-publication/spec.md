## ADDED Requirements

### Requirement: Bootstrap validation names the owning publication surface

Bootstrap documentation SHALL keep official Claude strict validation scoped to
the canonical repository root/marketplace and SHALL keep the generated
`plugins/dhpk/` package scoped to its native Codex validators. The documentation
MUST NOT claim that Claude's validator passes when pointed at the Codex-only
package.

#### Scenario: Claude validation targets the canonical root

- **WHEN** a bootstrap document gives an official Claude validation command
- **THEN** its target is the canonical checkout root containing the Claude
  marketplace/plugin manifests
- **AND** the command does not target `plugins/dhpk/`

#### Scenario: Codex package validation uses native evidence

- **WHEN** a bootstrap document describes validation for `plugins/dhpk/`
- **THEN** it names `node scripts/ci/verify-codex-native-package.js`,
  `node tests/codex-plugin-manifest.test.js`, or
  `node tests/codex-native-install-smoke.test.js` as the applicable evidence
- **AND** it does not use Claude's official validator as the package check
