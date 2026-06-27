# Phase 6.7: Configure Environment Variables

Full detail for `/project-setup` Phase 6.7.

**Skip if**: `--detect-only` or `--lite`.
**Run exclusively with**: `--env-only` (skip all other phases, jump directly to 6.7 → 7).

**Purpose**: Write recommended environment variables to `.claude/settings.json` `env` object, **independent of hook installation**. This phase runs even when `--no-hooks` is specified.

## 6.7.1 Env Var Catalog

| Variable | Default | Condition | Description |
|----------|---------|-----------|-------------|
| `STOP_GUARD_MODE` | `strict` | Always (override: `--guard-mode warn`) | Stop-guard enforcement mode |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `320000` | 1M context model detected | Auto-compact window size (tokens) — delays compaction to preserve more context |

### Legacy Recommendations (auto-upgrade prompt)

When an existing setting matches a previously recommended value (not the current one), flag it as `Upgrade` in the interactive table so the user can explicitly confirm the change. Never rewrite silently.

| Variable | Legacy value(s) | Current recommended | Retired on |
|----------|-----------------|---------------------|------------|
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `456000` | `320000` | 2026-04-17 |

## 6.7.2 Large Context Model Detection

Determine whether `CLAUDE_CODE_AUTO_COMPACT_WINDOW` should be recommended:

1. **Self-awareness check**: Claude can inspect its own system environment description for "1M context" indicators (e.g. model description includes "1M context" or "(with 1M context)")
2. **Detected** → include `CLAUDE_CODE_AUTO_COMPACT_WINDOW: "320000"` in recommendations with note: "1M context model detected"
3. **Not detected or uncertain** → ask user: "Are you using a 1M context model? (e.g. Claude Opus 4.6 1M)" — include in recommendations only on confirmation
4. **User declines** → omit `CLAUDE_CODE_AUTO_COMPACT_WINDOW` from recommendations

## 6.7.3 Interactive Flow

1. Read existing `env` values from **both** `.claude/settings.local.json` and `.claude/settings.json` (create `{}` if not exists). Runtime precedence: `settings.local.json` > `settings.json`
2. Build recommendations table showing **effective** current value:

   ```markdown
   ## Environment Variables

   Only one row per variable appears at a time; the examples below are **alternatives** for the same variable, selected by its current state.

   Example A — first-time install (variable not yet set):

   | Variable | Current (effective) | Source | Recommended | Action |
   |----------|---------------------|--------|-------------|--------|
   | STOP_GUARD_MODE | warn | settings.json | strict | Update |
   | CLAUDE_CODE_AUTO_COMPACT_WINDOW | (not set) | — | 320000 | Add (1M model) |

   Example B — upgrade path (variable already set to a legacy value):

   | Variable | Current (effective) | Source | Recommended | Action |
   |----------|---------------------|--------|-------------|--------|
   | CLAUDE_CODE_AUTO_COMPACT_WINDOW | 456000 | settings.json | 320000 | **Upgrade** (legacy value, retired 2026-04-17) |
   ```

3. Present to user for confirmation — user may accept all, modify values, or skip specific vars. For rows marked `Upgrade`, display the retirement date and reason so the user can make an informed decision.
4. Apply confirmed changes to `.claude/settings.json` (default) or `.claude/settings.local.json` (with `--local`)

## 6.7.4 Merge Strategy

- Read existing settings file (create `{}` if not exists)
- Merge env vars into `env` object:
  - If key does not exist → **Add**
  - If key exists and value matches current recommended → **Skip**
  - If key exists and value matches a **Legacy value** listed in 6.7.1 → **Upgrade** (surface retirement date + reason; apply only after user confirmation, never silently overwrite)
  - If key exists and value is user-custom (neither current nor legacy) → **Update** (only after user confirmation; default to preserving)
- Preserve all existing `env` keys not in the catalog (do not drop unknown keys)
- Preserve all non-`env` keys in settings (hooks, etc.)
- Write updated settings back

> **Note**: Runtime mode resolution for `STOP_GUARD_MODE` follows: env var > `settings.local.json` > `settings.json` > default `warn`. See `hooks/stop-guard.sh` for canonical precedence.

## 6.7.5 Interaction with Phase 6.3 and `/install-hooks`

- Phase 6.3 (within `/project-setup`) defers env writes to Phase 6.7
- `/install-hooks` (standalone command) retains its own `env.STOP_GUARD_MODE` write — it operates independently
- When both run in the same session, Phase 6.7 runs after Phase 6 and writes to the same target file
- `--no-hooks` skips Phase 6 but Phase 6.7 still runs → env vars are always configured

## 6.7.6 Output Env Config Report

```markdown
## Environment Config Report

**Target**: <repo-root>/.claude/settings.json (or settings.local.json with --local)

| Variable | Value | Effective Source | Status |
|----------|-------|-----------------|--------|
| STOP_GUARD_MODE | strict | settings.json | ✅ Updated |
| CLAUDE_CODE_AUTO_COMPACT_WINDOW | 320000 | settings.json | ✅ Added (1M model) — or ✅ Upgraded (456000 → 320000, legacy retired 2026-04-17) when upgrading |

**Model**: Opus 4.6 (1M context) → auto-compact window recommended
**Precedence note**: Runtime resolves env > settings.local.json > settings.json > default
```
