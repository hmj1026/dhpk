# harness-count-integrity Specification

## Purpose
TBD - created by archiving change dhpk-harness-integrity-guards. Update Purpose after archive.
## Requirements
### Requirement: Every declared count is enforced against computed reality

The count SSOT (`scripts/ci/catalog.js`) SHALL enforce every **exact-number** claim phrasing that
appears in `README.md`, `README.zh-TW.md`, `.claude-plugin/plugin.json`, and
`.claude-plugin/marketplace.json`, covering English agent counts, Traditional-Chinese agent counts,
root-agent counts, sentinel-slot counts, module counts, the **command count** (`commands/*.md`, also
claimed in `commands/do.md`), and the **hook-event count** (the number of distinct top-level event
keys in `hooks/hooks.json`). The command count and hook-event count SHALL be exact enforced claims:
the previously hand-reconciled `~`-approximate command count is converted to an exact claim, and any
`~` prefix on it is removed. `node scripts/ci/catalog.js --check` SHALL exit non-zero when any
enforced exact claim disagrees with the value computed from the repository.

#### Scenario: Chinese agent-count claim drifts

- **WHEN** `README.zh-TW.md` states a `個角色導向 agent` count that differs from the computed agent total
- **THEN** `node scripts/ci/catalog.js --check` reports a DRIFT line and exits non-zero

#### Scenario: Sentinel-slot count drifts

- **WHEN** any file claims an `N-slot` sentinel count that differs from the length of `SENTINEL_NAMES` in `payload.sh`
- **THEN** `node scripts/ci/catalog.js --check` reports a DRIFT line and exits non-zero

#### Scenario: Command count drifts

- **WHEN** `commands/do.md` states a command count that differs from the number of `commands/*.md` files computed by `catalog.js`
- **THEN** `node scripts/ci/catalog.js --check` reports a DRIFT line and exits non-zero

#### Scenario: Hook-event count drifts

- **WHEN** a README states a hook-event count that differs from the number of distinct top-level event keys in `hooks/hooks.json`
- **THEN** `node scripts/ci/catalog.js --check` reports a DRIFT line and exits non-zero

#### Scenario: All claims match reality

- **WHEN** every enforced claim equals its computed value
- **THEN** `node scripts/ci/catalog.js --check` prints PASS and exits zero

### Requirement: Sentinel-slot count is derived from the sentinel SSOT

`scripts/ci/catalog.js` SHALL compute the sentinel-slot count by parsing the `SENTINEL_NAMES`
array in `scripts/hooks/_lib/payload.sh`, so that a slot-count claim can never diverge from the
authoritative array. The computed count SHALL be greater than zero.

#### Scenario: A slot is added to payload.sh

- **WHEN** a new entry is added to `SENTINEL_NAMES` in `payload.sh`
- **THEN** the catalog slot count reflects the new array length without any change to `catalog.js`

### Requirement: Drift is auto-fixable in place

`node scripts/ci/catalog.js --write` SHALL rewrite every drifted enforced claim to its computed
value across the claim files, and report the number of claim groups updated.

#### Scenario: Operator repairs drift

- **WHEN** an operator runs `node scripts/ci/catalog.js --write` with drifted claims present
- **THEN** the claim files are rewritten to the computed values and a subsequent `--check` passes

### Requirement: Codex surface counts are enforced against computed reality

The count SSOT (`scripts/ci/catalog.js`) SHALL compute the number of MCP-backed `codex-*` skills (skills under `skills/codex-*/` whose SKILL.md references `mcp__codex__`) and the number of `commands/codex-*.md` files, and SHALL enforce the exact-count claims for these two values in `README.md` and `README.zh-TW.md`. `node scripts/ci/catalog.js --check` SHALL exit non-zero when either enforced claim disagrees with the computed value.

#### Scenario: A new MCP-backed codex skill is added without a README update

- **WHEN** a sixth MCP-backed codex skill (seventh `skills/codex-*/` directory) referencing `mcp__codex__` lands but README still claims 5 MCP-backed skills
- **THEN** `node scripts/ci/catalog.js --check` reports a DRIFT line and exits non-zero

#### Scenario: Counts match reality

- **WHEN** the README claims equal the computed codex skill and command counts
- **THEN** `node scripts/ci/catalog.js --check` prints PASS and exits zero

### Requirement: Inventory and publication counts are separate
The count SSOT SHALL compute and label at least canonical, promoted-core, optional, experimental, deprecated, and per-host published skill counts. Documentation SHALL use the count whose scope matches the claim and SHALL NOT present canonical inventory as the default installed surface.

#### Scenario: README claims all canonical skills are installed by default
- **WHEN** the promoted-core count differs from the canonical skill count but README uses the canonical count for the default install
- **THEN** catalog validation reports a scoped-count drift and exits non-zero

#### Scenario: Lifecycle transition updates scoped counts
- **WHEN** a skill moves from `promoted` to `deprecated`
- **THEN** the canonical count remains unchanged, the promoted count decreases, and the deprecated count increases without manual arithmetic

### Requirement: Generated-package counts are verified from package contents
Release validation SHALL compute the Claude and Codex published counts from the generated or staged package contents and reconcile them with the distribution inventory.

#### Scenario: Generated Codex package omits a promoted skill
- **WHEN** the inventory permits a promoted skill on the native Codex surface but the physical package lacks it
- **THEN** the package count/content validation fails with the missing skill name
