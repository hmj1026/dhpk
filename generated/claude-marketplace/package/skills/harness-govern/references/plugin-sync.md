# Plugin Sync (S1-S3) — Mechanics & Fix Delegation

Full sync-module reference for `harness-govern health`. Runs when `--scope sync` or
`--scope all` (default). Read-only diagnostic; all mutations delegate to the
explicit `$harness-setup --install ...` operation per the Fix Tiers below. The
deprecated `/install-*` commands remain forwarding aliases, not a second
installer contract.

## S1: Version Check

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| S1.1 | Manifest exists | Read `.dhpk/install-state.json` (if absent, fall back to legacy `.sd0x/install-state.json` for migration read only) | Missing → P1 |
| S1.2 | Manifest parseable | JSON.parse | Parse error → P1 |
| S1.3 | `schema_version` current | `== 1` | Mismatch → P2 |
| S1.4 | `plugin_version` matches | manifest vs selected-source-root metadata | Mismatch → P1 |
| S1.5 | Manifest completeness | Has `rules` + `hook_scripts` + `scripts` keys | Missing key → P2 (`MANIFEST_GAP`) |

**Plugin version resolution** (priority order within the selected source root):

```
<selected-source-root>/.claude-plugin/plugin.json
  → <selected-source-root>/package.json
  → "unknown"
```

## Selected consumer distribution and source

Resolve and record one explicit source/target pair before comparing content:

| Role | Path contract |
|---|---|
| Consumer root | The project selected by the active Host adapter |
| Consumer target | `<consumer-root>/.claude/dhpk/` |
| Distribution source | `<selected-source-root>/`, supplied by the active Host package or an explicitly selected `--source` for `<selected-source-root>/scripts/setup/install-assets.sh` |

The source root is a consumer-selected distribution input. Do not substitute
the invoked Skill directory, a sibling Skill, an ambient parent checkout, or a
guessed plugin cache. Include the resolved source and target paths in every
report; if the selected source is unavailable, stop with `BLOCKED`.

## S2: Component Classification

For each component selected by the live installer plan or consumer manifest,
compute three hashes and classify. The selected set is data, not a fixed file
count:

```bash
manifest_hash  = manifest[category][filename].hash    # null if missing
local_hash     = git hash-object --no-filters <target-path>  # null if missing
source_hash    = git hash-object --no-filters <source-path>  # selected distribution truth
```

`<source-path>` and `<target-path>` are resolved from the selected source and
consumer target above. Preserve the manifest's recorded values and unknown
keys while checking them.

**Classification table** (read-only diagnostic; maps to the installer action
states used by the Fix Tiers below):

| Doctor State | Condition | Severity | Installer handling |
|-------|-----------|----------|--------------------------|
| `OK` | local == manifest == source | ✅ | `SKIP` |
| `MISSING` | local_hash is null, source exists | P1 | `FRESH_INSTALL` |
| `OUTDATED` | local == manifest, source != manifest | P1 | Report, then explicitly approved `--force` update |
| `LOCAL_MODIFIED` | local != manifest, source == manifest | ✅ | `KEEP_LOCAL` |
| `CONFLICT` | local != manifest, source != manifest | P2 | `CONFLICT` |
| `LEGACY` | manifest_hash is null, local exists | P2 | `LEGACY` |
| `MANIFEST_GAP` | manifest category key missing | P2 | N/A |
| `TOMBSTONED` | manifest `deleted: true`, local missing | ✅ | `SKIP_DELETED` |

## Selected component paths

The current `<selected-source-root>/scripts/setup/install-assets.sh` source/target roots are:

| Selection | Distribution source | Consumer target |
|---|---|---|
| `hooks` | `<selected-source-root>/hooks/` | `<consumer-root>/.claude/dhpk/hooks/` |
| `hooks` | `<selected-source-root>/scripts/hooks/` | `<consumer-root>/.claude/dhpk/scripts/hooks/` |
| `rules` | `<selected-source-root>/rules/` | `<consumer-root>/.claude/dhpk/rules/` |
| `scripts` | `<selected-source-root>/scripts/` | `<consumer-root>/.claude/dhpk/scripts/` |
| `scripts` | `<selected-source-root>/skills/precommit/scripts/` | `<consumer-root>/.claude/dhpk/skills/precommit/scripts/` |
| `scripts` | `<selected-source-root>/skills/repo-verify/scripts/` | `<consumer-root>/.claude/dhpk/skills/repo-verify/scripts/` |
| `scripts` | `<selected-source-root>/skills/harness-audit/scripts/` | `<consumer-root>/.claude/dhpk/skills/harness-audit/scripts/` |

The current pilot runner files under the selected distribution source are:

| Pilot | Source file | Consumer target |
|---|---|---|
| `precommit` | `<selected-source-root>/skills/precommit/scripts/precommit-runner.js` | `<consumer-root>/.claude/dhpk/skills/precommit/scripts/precommit-runner.js` |
| `precommit` | `<selected-source-root>/skills/precommit/scripts/lib/runner-utils.js` | `<consumer-root>/.claude/dhpk/skills/precommit/scripts/lib/runner-utils.js` |
| `repo-verify` | `<selected-source-root>/skills/repo-verify/scripts/verify-runner.js` | `<consumer-root>/.claude/dhpk/skills/repo-verify/scripts/verify-runner.js` |
| `repo-verify` | `<selected-source-root>/skills/repo-verify/scripts/lib/runner-utils.js` | `<consumer-root>/.claude/dhpk/skills/repo-verify/scripts/lib/runner-utils.js` |
| `harness-audit` | `<selected-source-root>/skills/harness-audit/scripts/harness-audit.js` | `<consumer-root>/.claude/dhpk/skills/harness-audit/scripts/harness-audit.js` |

These are paths in the explicitly selected distribution source. They are not
dependencies on the currently invoked `harness-govern` Skill directory.

The selected scripts source skips the legacy root runner names
`precommit-runner.js`, `verify-runner.js`, and `harness-audit.js`. A matching
file already present at `<consumer-root>/.claude/dhpk/scripts/` is preserved and
reported as a legacy conflict for manual reconciliation; it is not a current
Skill-local dependency.

## S2.5: Override Safeguard Checks

5 checks for project override files (e.g., `auto-loop-project.md`):

| # | Check | Severity | Detection | Recommendation |
|---|-------|----------|-----------|----------------|
| 1 | Override drift | P2 | `based_on` hash comment in project file vs current base file hash | "Base auto-loop updated since override authored; review your overrides" |
| 2 | Policy contradiction | P1 | Override's Auto-Trigger table omits a review command required by the Review Gate dispatch contract | "Override conflicts with Review Gate obligation routing" |
| 3 | Missing reference | P1 | `.claude/CLAUDE.md` has `@rules/auto-loop-project.md` but file missing, OR file exists but not referenced | Report the missing project override for explicit reconciliation |
| 4 | Wrong-layer edit | P2 | Base `auto-loop.md` has `LOCAL_MODIFIED`, `CONFLICT`, or `LEGACY` state while project override exists | "Move customization to auto-loop-project.md" |
| 5 | Duplicate heading | P2 | Override file has multiple active `## <heading>` with same text | "Keep one, remove duplicates. Last occurrence takes effect." |

**Policy contradiction detection**: Parse the project override's Auto-Trigger table for required check commands. Cross-reference against the Review Gate obligation contract: if the override omits `/dhpk:change-verdict --mode code` for code changes or `/dhpk:change-verdict --mode docs` for `.md` changes, flag as P1.

**Override drift detection**: Read the `<!-- Based on: auto-loop.md @ <hash> -->` comment from the project file. Compare against `git hash-object --no-filters .claude/rules/auto-loop.md | cut -c1-7`. If different, the base has been updated since the override was authored. Uses blob hash for content-level comparison; accepts legacy commit-style hashes (any 7+ hex chars) during backward-compat transition.

## S3: Settings Compatibility

Check **both** `settings.json` and `settings.local.json` (precedence: `settings.local.json` > `settings.json`). A hook entry in either file satisfies the integrity check.

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| S3.1 | Legacy hook paths | Grep both settings files for bare `.claude/hooks/` without `$CLAUDE_PROJECT_DIR` | Found → P2 |
| S3.2 | `STOP_GUARD_MODE` present | Read `env.STOP_GUARD_MODE` from either settings file (also check legacy `hooks_config.stop_guard_mode`) | Missing from both → P2 (info). Legacy `hooks_config` found → P2 (migration recommended). Install-time default: `strict`; runtime fallback: `warn` |
| S3.3 | Hook entry integrity | Each installed hook script has matching entry in either settings file | Missing from both → P1 |
| S3.4 | Orphan hook entries | Either settings file references script that doesn't exist on disk | Orphan → P2 |

**Settings file precedence**: `settings.local.json` overrides `settings.json` at runtime. Asset installation does not edit either settings file; report the selected settings path and route any approved configuration change through the active Host setup flow.

**Legacy path detection**:

```
Grep for: "\.claude/hooks/[^"]+\.sh"  (without leading "$CLAUDE_PROJECT_DIR")
Applied to both: settings.json and settings.local.json
```

## Fix Tiers

> Only applies when `--fix-safe` or `--fix` is specified alongside sync scope.

| Tier | Flag | Description |
|------|------|-------------|
| Report | (default) | Diagnosis only — output actionable recommendations |
| Safe | `--fix-safe` | Auto-fix P1 hygiene + safe sync fixes |
| Guided | `--fix` | Auto-fix P1 hygiene + guided sync remediation (interactive) |

**Category-specific safe fix delegation**:

Before delegating any fix that Writes `.claude/dhpk-versions.json` or a consumer `CLAUDE.md`, check whether the target is a symlink. If so, resolve it and instruct the worker to Write the realpath (for example, `realpath .claude/dhpk-versions.json`); the Write tool refuses symlinked targets.

| Category | `MISSING` | `OUTDATED` | `CONFLICT`/`LEGACY` |
|----------|----------|-----------|---------------------|
| Rules | `$harness-setup --install rules` after reviewing the selected source/target plan | Report only + suggest the same operation with explicit `--force` approval | Skip (report only) |
| Hooks | `$harness-setup --install hooks` after reviewing the selected source/target plan | Report only + suggest the same operation with explicit `--force` approval | Skip (report only) |
| Scripts | `$harness-setup --install scripts` after reviewing the selected source/target plan | Report only + suggest the same operation with explicit `--force` approval | Skip (report only) |

> **Why OUTDATED is report-only in the safe tier**: the live asset installer uses identical-file skip and differing-file conflict semantics; `--force` is an explicit overwrite boundary. Health never turns a source/target comparison into an implicit write.

**S3 settings boundary**: Health never writes settings JSON. Route an approved settings change through the active Host setup flow; the asset installer only reports or copies its selected source groups.

**`--fix` tier**: Delegates actionable missing or outdated asset states to the selected `$harness-setup --install <group>` operation. Conflicts, legacy files, malformed manifests, and unsafe paths remain visible for manual resolution; the health Skill does not overwrite them.

**Argument conflict**: `--fix` and `--fix-safe` are mutually exclusive. If both specified, error.
