# Plugin Sync (S1-S3) — Mechanics & Fix Delegation

Full sync-module reference for `claude-health`. Runs when `--scope sync` or
`--scope all` (default). Read-only diagnostic; all mutations delegate to the
`/install-*` commands per the Fix Tiers below.

## S1: Version Check

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| S1.1 | Manifest exists | Read `.dhpk/install-state.json` (if absent, fall back to legacy `.sd0x/install-state.json` for migration read only) | Missing → P1 |
| S1.2 | Manifest parseable | JSON.parse | Parse error → P1 |
| S1.3 | `schema_version` current | `== 1` | Mismatch → P2 |
| S1.4 | `plugin_version` matches | manifest vs `.claude-plugin/plugin.json` or `package.json` | Mismatch → P1 |
| S1.5 | Manifest completeness | Has `rules` + `hook_scripts` + `scripts` keys | Missing key → P2 (`MANIFEST_GAP`) |

**Plugin version resolution** (priority order):

```
.claude-plugin/plugin.json → package.json → "unknown"
```

**Plugin source location** (same as `/install-rules` Phase 1):

```
Glob: ~/.claude/plugins/**/dhpk/rules/execution-policy.md
Glob: ${REPO_ROOT}/node_modules/dhpk/rules/execution-policy.md
Fallback: @rules/execution-policy.md (plugin-relative)
```

## S2: Component Classification

For each managed component (rules, hooks, scripts), compute 3 hashes and classify:

```bash
manifest_hash  = manifest[category][filename].hash    # null if missing
local_hash     = git hash-object --no-filters <local-path>  # null if file missing
plugin_hash    = git hash-object --no-filters <plugin-path>  # source of truth
```

**Classification table** (read-only diagnostic; maps to install-rules states for delegation):

| Doctor State | Condition | Severity | install-rules Equivalent |
|-------|-----------|----------|--------------------------|
| `OK` | local == manifest == plugin | ✅ | `SKIP` |
| `MISSING` | local_hash is null, plugin exists | P1 | `FRESH_INSTALL` |
| `OUTDATED` | local == manifest, plugin != manifest | P1 | `AUTO_UPDATE` |
| `LOCAL_MODIFIED` | local != manifest, plugin == manifest | ✅ | `KEEP_LOCAL` |
| `CONFLICT` | local != manifest, plugin != manifest | P2 | `CONFLICT` |
| `LEGACY` | manifest_hash is null, local exists | P2 | `LEGACY` |
| `MANIFEST_GAP` | manifest category key missing | P2 | N/A |
| `TOMBSTONED` | manifest `deleted: true`, local missing | ✅ | `SKIP_DELETED` |

**Managed inventory** (hardcoded, 23 files):

| Category | Local Path | Plugin Source | Files |
|----------|-----------|--------------|-------|
| Rules | `.claude/rules/*.md` | `rules/*.md` | `auto-loop.md`, `codex-invocation.md`, `fix-all-issues.md`, `framework.md`, `testing.md`, `security.md`, `git-workflow.md`, `logging.md`, `docs-writing.md`, `docs-numbering.md`, `self-improvement.md`, `context-management.md` |
| Hooks | `.claude/hooks/*.sh` | `hooks/*.sh` | `pre-edit-guard.sh`, `post-edit-format.sh`, `post-tool-review-state.sh`, `stop-guard.sh`, `post-compact-auto-loop.sh` |
| Scripts | `.claude/scripts/` | `scripts/` | `precommit-runner.js`, `verify-runner.js`, `dep-audit.sh`, `commit-msg-guard.sh`, `pre-push-gate.sh`, `lib/utils.js` |

## S2.5: Override Safeguard Checks

5 checks for project override files (e.g., `auto-loop-project.md`):

| # | Check | Severity | Detection | Recommendation |
|---|-------|----------|-----------|----------------|
| 1 | Override drift | P2 | `based_on` hash comment in project file vs current base file hash | "Base auto-loop updated since override authored; review your overrides" |
| 2 | Policy contradiction | P1 | Override's Auto-Trigger table omits a command that `stop-guard.sh` requires | "Override conflicts with stop-guard enforcement" |
| 3 | Missing reference | P1 | `.claude/CLAUDE.md` has `@rules/auto-loop-project.md` but file missing, OR file exists but not referenced | `/install-rules` to recreate or add reference |
| 4 | Wrong-layer edit | P2 | Base `auto-loop.md` has `LOCAL_MODIFIED`, `CONFLICT`, or `LEGACY` state while project override exists | "Move customization to auto-loop-project.md" |
| 5 | Duplicate heading | P2 | Override file has multiple active `## <heading>` with same text | "Keep one, remove duplicates. Last occurrence takes effect." |

**Policy contradiction detection**: Parse the project override's Auto-Trigger table for required check commands. Cross-reference against hook-enforced sentinels: if override omits `/codex-review-fast` for code changes or `/codex-review-doc` for `.md` changes, flag as P1.

**Override drift detection**: Read the `<!-- Based on: auto-loop.md @ <hash> -->` comment from the project file. Compare against `git hash-object --no-filters .claude/rules/auto-loop.md | cut -c1-7`. If different, the base has been updated since the override was authored. Uses blob hash for content-level comparison; accepts legacy commit-style hashes (any 7+ hex chars) during backward-compat transition.

## S3: Settings Compatibility

Check **both** `settings.json` and `settings.local.json` (precedence: `settings.local.json` > `settings.json`). A hook entry in either file satisfies the integrity check.

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| S3.1 | Legacy hook paths | Grep both settings files for bare `.claude/hooks/` without `$CLAUDE_PROJECT_DIR` | Found → P2 |
| S3.2 | `STOP_GUARD_MODE` present | Read `env.STOP_GUARD_MODE` from either settings file (also check legacy `hooks_config.stop_guard_mode`) | Missing from both → P2 (info). Legacy `hooks_config` found → P2 (migration recommended). Install-time default: `strict`; runtime fallback: `warn` |
| S3.3 | Hook entry integrity | Each installed hook script has matching entry in either settings file | Missing from both → P1 |
| S3.4 | Orphan hook entries | Either settings file references script that doesn't exist on disk | Orphan → P2 |

**Settings file precedence**: `settings.local.json` overrides `settings.json` at runtime. When delegating S3 fixes, use `/install-hooks --local` if the issue is in `settings.local.json`.

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

| Category | `MISSING` | `OUTDATED` | `CONFLICT`/`LEGACY` |
|----------|----------|-----------|---------------------|
| Rules | `/install-rules <names>` | `/install-rules <names>` (smart merge AUTO_UPDATE) | Skip (report only) |
| Hooks | `/install-hooks <names>` | Report only + suggest `/install-hooks <names> --force` | Skip (report only) |
| Scripts | `/install-scripts <names>` | Report only + suggest `/install-scripts <names> --force` | Skip (report only) |

> **Why hooks/scripts OUTDATED is report-only in safe tier**: `/install-hooks` and `/install-scripts` use skip/force semantics (no manifest-aware smart merge). Only `/install-rules` has 7-state classification for safe auto-update.

**S3 settings fix delegation**: All settings mutations delegate to `/install-hooks` (sync module never writes JSON directly).

**`--fix` tier**: Delegates all actionable states (including CONFLICT, LEGACY) to `/install-*` commands which handle interactive resolution.

**Argument conflict**: `--fix` and `--fix-safe` are mutually exclusive. If both specified, error.
