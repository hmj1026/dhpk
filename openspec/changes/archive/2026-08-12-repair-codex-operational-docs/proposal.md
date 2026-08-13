## Why

Issues #155 and #156 expose drift in the current Codex operational contract. The
installation guide tells users to run source-check commands from a consumer
project root where those files do not exist, and four current English/
Traditional Chinese guides still describe an 11-role/7-generated projection
after the repository shipped 16 roles/12 generated roles.

## What Changes

- Separate consumer-project receipt checks from dhpk-checkout source validators
  in the bilingual platform-installation guide.
- Make documented source validators use an explicit `DHPK_ROOT` or absolute
  checkout path and define the working directory for each command.
- Update current operational docs to report the role counts from the live Codex
  projection contract: 16 direct roles and 12 generated roles.
- Add deterministic documentation regression checks for command context and
  role-count parity; historical documents remain out of scope.
- Record issue links, local source evidence, and validator results in the
  change's implementation evidence.

## Capabilities

### New Capabilities

- `codex-operational-documentation`: current Codex installation and role-roster
  guidance is executable from the stated root and remains synchronized with the
  repository's projection metadata.

### Modified Capabilities

None.

## Impact

- `docs/platform-installation.md` and `docs/platform-installation.zh-TW.md`.
- `docs/basic-operations.md`, `docs/basic-operations.zh-TW.md`,
  `docs/configuration.md`, and `docs/configuration.zh-TW.md`.
- Documentation parity tests under `tests/`.
- No runtime installer, public API, package schema, or consumer receipt change.
