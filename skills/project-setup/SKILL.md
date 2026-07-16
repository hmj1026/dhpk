---
name: project-setup
description: 'Project configuration initialization. Use when: first-time setup, auto-detecting framework, replacing CLAUDE.md placeholders. Not for: ongoing config checks (use claude-health), skill creation (use skill-creator). Output: configured CLAUDE.md + project settings + rules + hooks.'
allowed-tools: 'Read, Grep, Glob, Edit, Write, Bash(node:*), Bash(git:*), Bash(ls:*), Bash(mkdir:*), Bash(diff:*), Bash(chmod:*), Bash(jq:*), Bash(bash:*)'
# context: shared (default) — intentionally NOT fork because Phase 2 requires user confirmation
---

# Project Setup

## Trigger

- Keywords: project setup, init, initialize, configure project, setup CLAUDE.md, customize placeholders

## When NOT to Use

- CLAUDE.md placeholders are already fully replaced (no `{...}` remaining)
- Non Node.js/TypeScript project without a recognized manifest file -- run with `--detect-only` to see what can be auto-detected. Manual configuration may be needed for: {FRAMEWORK}, {CONFIG_FILE}, {BOOTSTRAP_FILE}. Script commands ({TEST_COMMAND}, etc.) can often be detected from manifest files
- Only want to modify a single placeholder -- just Edit CLAUDE.md directly

## Workflow

```
Phase 1   Detect project environment (manifest, lockfile, framework, DB, entrypoints, scripts)
Phase 2   Confirm detection results → wait for user confirmation/corrections
Phase 2.5 Select ecosystem blocks (map manifest → ecosystem tag)
Phase 3   Write to .claude/CLAUDE.md (filter blocks, replace placeholders) — unless --detect-only
Phase 4   Verify CLAUDE.md (no remaining placeholders)
Phase 5   Install Rules + backfill CLAUDE.md @rules/ refs — unless --no-rules / --lite
          → references/install-rules-phase.md
Phase 6   Install Hooks (copy 5 hooks + merge settings.json) — unless --no-hooks / --lite
          → references/install-hooks-scripts.md
Phase 6.5 Install Scripts (3 runner scripts + manifest) — unless --lite / --detect-only
          → references/install-hooks-scripts.md
Phase 6.7 Configure env vars (STOP_GUARD_MODE + model-aware vars) — unless --detect-only / --lite
          → references/env-config-phase.md
Phase 7   Final verification report + closed-loop check
          → references/final-phase.md
```

### Flag Short-Circuit Semantics

| Flag | Phase 1-2 | Phase 3-4 | Phase 5-6.5 | Phase 6.7 | Phase 7 |
|------|-----------|-----------|-----------|-----------|---------|
| (none) | Execute | Execute | Execute | Execute | Full report |
| `--detect-only` | Execute | Skip | Skip | Skip | Detection results only |
| `--lite` | Execute | Execute | Skip | Skip | CLAUDE.md only |
| `--no-rules` | Execute | Execute | Skip rules | Execute | Report |
| `--no-hooks` | Execute | Execute | Skip hooks | Execute | Report |
| `--env-only` | Skip | Skip | Skip | Execute | Env report only (skill-level directive) |
| `--guard-mode warn` | Execute | Execute | Execute | Execute (STOP_GUARD_MODE=warn) | Report |

## Phase 1: Detect Project Environment

Run detections in order (full rules in `references/detection-rules.md`):

1. **Detect Ecosystem** — Glob for manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `build.gradle`, `pom.xml`, `Gemfile`). Priority order in detection-rules.md.
2. **Read manifest** — Extract project name, dependencies, scripts (Node.js: `package.json`; others: ecosystem manifest)
3. **Detect Package Manager** — Lockfile detection (Node.js): `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm
4. **Detect Framework / Database / Entrypoints / Scripts** — From dependencies + manifest scripts. Missing scripts → `# N/A (no script found)`. See `references/detection-rules.md#framework`, `#database`, `#entrypoints`, `#scripts`

For non-Node.js ecosystems, skip Node-specific steps and use ecosystem-specific detection from `references/detection-rules.md`.

## Phase 2: Confirm Detection Results

Present a table of all 9 auto-detected placeholders with `| Placeholder | Detected Value | Source |` columns. Additional manual placeholders (`{TICKET_PATTERN}`, `{ISSUE_TRACKER_URL}`, `{TARGET_BRANCH}`) may remain if not auto-detectable — note these as "manual" in Phase 4. **Wait for user confirmation** before Phase 3.

## Phase 2.5: Select Ecosystem Blocks

Based on detected manifest (from Phase 1):

| Manifest | Ecosystem tag |
|----------|--------------|
| `package.json` | `node-ts` |
| `pyproject.toml` | `python` |
| `go.mod` | `go` |
| `Cargo.toml` | `rust` |
| `Gemfile` | `ruby` |
| `pom.xml` / `build.gradle` | `java` |

## Phase 3: Write to .claude/CLAUDE.md

**Prerequisite**: User confirmed, and not in `--detect-only` mode.

1. Read `CLAUDE.md`
2. Remove `<!-- block:X -->...<!-- /block -->` sections NOT matching detected ecosystem, then remove remaining block markers
3. `Edit` each placeholder (`replace_all: true`)
4. Write to `.claude/CLAUDE.md` (create directory / file if needed)
   - If the target exists as a symlink, resolve `realpath .claude/CLAUDE.md` and Write to that resolved target; the Write tool refuses symlinks.

## Phase 4: Verify CLAUDE.md

1. Read `.claude/CLAUDE.md`
2. `Grep: \{[A-Z_]+\}` — confirm no remaining auto-detected placeholders. Exclude `${...}` shell variable matches (e.g. `${CLAUDE_PLUGIN_ROOT}`) — these are intentional env refs, not unfilled placeholders.
3. Output summary table with all placeholder values + remaining count

If `--detect-only` or `--lite`, skip to Phase 7.

## Phase 5: Install Rules + Backfill CLAUDE.md

**Skip if**: `--no-rules` / `--lite` / `--detect-only`. Fresh-install semantics (install new / skip identical / warn on conflict; for smart merge run `/install-rules`).

- **Locate** plugin `rules/` via 3-level fallback (Glob plugin dirs → `node_modules` → `@rules/` relative); not found → hard error + remediation, skip to Phase 6 (Phase 7 reports `⚠️ Partial`)
- **Reference** the 4 shipped rules (`anti-rationalization.md`, `execution-policy.md`, `model-economics.md`, `tool-routing.md`) by `${CLAUDE_PLUGIN_ROOT}/rules/` path — no local copies — then record state in `.dhpk/install-state.json` (preserve unknown keys)
- **Backfill** `.claude/CLAUDE.md` with `@rules/` references so the rules activate (closed-loop guarantee)
- Before any backfill Write, resolve and use the realpath when `.claude/CLAUDE.md` is a symlink; the Write tool refuses symlinks.
- Full rule list, conflict strategy, manifest schema, backfill branches, and report template → **`references/install-rules-phase.md`**

## Phase 6: Install Hooks

**Skip if**: `--no-hooks` / `--lite` / `--detect-only`.

- **Locate** plugin `hooks/` via same 3-level fallback (search `pre-edit-guard.sh`); not found → hard error + remediation
- **Copy** 5 hooks + `chmod +x`; exclude plugin-only `namespace-hint.sh`
- **Merge** hook definitions into `.claude/settings.json` (append-only, `$CLAUDE_PROJECT_DIR` paths, legacy-path migration). Env vars are deferred to Phase 6.7.
- Hook table, full JSON mapping, merge strategy, and report template → **`references/install-hooks-scripts.md`**

## Phase 6.5: Install Scripts

**Skip if**: `--lite` / `--detect-only`.

- **Locate** plugin `scripts/` via same fallback (search `precommit-runner.js`); not found → warn + skip (`⚠️ Partial`)
- **Copy** 3 scripts (`precommit-runner.js`, `verify-runner.js`, `lib/utils.js`), then update `.dhpk/install-state.json` `scripts` key with per-file hashes
- Script table, conflict strategy, manifest detail, and report template → **`references/install-hooks-scripts.md`**

## Phase 6.7: Configure Environment Variables

**Skip if**: `--detect-only` / `--lite`. **Runs even with `--no-hooks`** (env config is independent of hook install). **`--env-only`** jumps straight here → Phase 7.

- Catalog: `STOP_GUARD_MODE` (default `strict`, override `--guard-mode warn`) + `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (`320000`, only when a 1M context model is detected)
- Detect 1M model via self-awareness check; if uncertain, ask the user before recommending
- Interactive: show effective current value + recommended + action (Add / Update / **Upgrade** legacy / Skip); apply only after confirmation, never silently overwrite. Target `.claude/settings.json` (or `settings.local.json` with `--local`)
- Catalog detail, legacy-value table, detection logic, merge strategy, and report template → **`references/env-config-phase.md`**

## Phase 7: Final Verification Report

Summarize all phases and perform the closed-loop check:

| Condition | Check | Required |
|-----------|-------|----------|
| CLAUDE.md behavior text | `Required Checks` section exists | ✅ |
| `@rules/` references | `@rules/execution-policy.md` in `.claude/CLAUDE.md` | ✅ |
| Rule files | `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` accessible | ✅ |
| Hook enforcement | `stop-guard` in `.claude/settings.json` | ✅ |
| Script runners | `.claude/scripts/precommit-runner.js` exists | ✅ (unless `--lite` / `--detect-only`) |
| Guard mode | `env.STOP_GUARD_MODE` = `strict` in target settings | ✅ (unless `--guard-mode warn`) |
| Auto-compact window | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` in target settings | ✅ (1M model only) |

Full final-output block (per-phase status table, closed-loop status variants, `--detect-only` / `--lite` output shapes, next steps) → **`references/final-phase.md`**

## Output

A configured project harness plus a final report. Deliverables:

- `.claude/CLAUDE.md` — placeholders replaced, ecosystem blocks filtered, `@rules/` references present
- 4 shipped rules referenced by path (`${CLAUDE_PLUGIN_ROOT}/rules/`) — no local copies (unless `--no-rules` / `--lite`)
- `.claude/hooks/` — 5 executable hooks + merged `.claude/settings.json` definitions (unless `--no-hooks` / `--lite`)
- `.claude/scripts/` — `precommit-runner.js`, `verify-runner.js`, `lib/utils.js` (unless `--lite` / `--detect-only`)
- `.claude/settings.json` `env` — `STOP_GUARD_MODE` (+ `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for 1M models)
- `.dhpk/install-state.json` — manifest of installed rule/script hashes
- A final report ending in a Closed-Loop Status line (✅ fully configured / ⚠️ Partial / ℹ️). Exact format in `references/final-phase.md`.

## Verification

- [ ] All 9 auto-detected placeholders detected or marked N/A
- [ ] User confirmed detection results before writing
- [ ] No remaining auto-detected `{UPPER_CASE}` placeholders in `.claude/CLAUDE.md` after setup (manual placeholders like `{TICKET_PATTERN}` are acceptable)
- [ ] `.claude/CLAUDE.md` references the 4 shipped rules by `${CLAUDE_PLUGIN_ROOT}/rules/` path (unless `--no-rules` or `--lite`)
- [ ] `.claude/hooks/` contains 5 `.sh` files with execute permission (unless `--no-hooks` or `--lite`)
- [ ] `.claude/settings.json` contains hook definitions (unless `--no-hooks` or `--lite`)
- [ ] `.claude/scripts/` contains `precommit-runner.js`, `verify-runner.js`, and `lib/utils.js` (unless `--lite` or `--detect-only`)
- [ ] `.claude/CLAUDE.md` contains `@rules/execution-policy.md` reference (unless `--lite`)
- [ ] `env.STOP_GUARD_MODE` is set in target settings file (unless `--detect-only` or `--lite`)
- [ ] `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set in target settings file when 1M model detected (unless `--detect-only` or `--lite`)

## References

- [detection-rules.md](./references/detection-rules.md) — read when detecting ecosystem, package manager, framework, database, entrypoints, or scripts (Phase 1)
- [install-rules-phase.md](./references/install-rules-phase.md) — read when installing rules: locate logic, 4-rule list, conflict strategy, manifest schema, CLAUDE.md backfill, report (Phase 5)
- [install-hooks-scripts.md](./references/install-hooks-scripts.md) — read when installing hooks or scripts: hook/script tables, settings.json JSON mapping, merge strategy, manifest, reports (Phases 6 & 6.5)
- [env-config-phase.md](./references/env-config-phase.md) — read when configuring env vars: catalog, legacy-value upgrade table, 1M-model detection, interactive flow, merge strategy, report (Phase 6.7)
- [final-phase.md](./references/final-phase.md) — read when writing the final report: closed-loop check, full output block, status variants, `--detect-only` / `--lite` shapes (Phase 7)
