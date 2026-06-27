# Phase 6: Install Hooks & Phase 6.5: Install Scripts

Full detail for `/project-setup` Phases 6 and 6.5.

---

## Phase 6: Install Hooks

**Skip if**: `--no-hooks` or `--lite` or `--detect-only`.

### 6.1 Locate Plugin Hooks Directory

Same 3-level fallback as Phase 5.1, but search for `hooks/pre-edit-guard.sh`:

1. `Glob: ~/.claude/plugins/**/sd0x-dev-flow/hooks/pre-edit-guard.sh`
2. `Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/hooks/pre-edit-guard.sh`
3. Plugin-relative fallback: `@hooks/pre-edit-guard.sh`
4. **Not found** → **hard error for this phase** (do not silently skip). Output explicit failure with remediation steps:

   ```
   ⛔ Hook source not found. Auto-loop enforcement layer cannot be installed.

   Remediation (choose one):
   1. Install the plugin: /plugin marketplace add sd0xdev/sd0x-dev-flow && /plugin install sd0x-dev-flow@sd0xdev-marketplace
   2. Copy hooks manually from a machine that has the plugin installed
   3. Re-run with --no-hooks to skip (enforcement layer will be missing)
   ```

   Then skip Phase 6 and continue to Phase 7. Phase 7 will report this as `⚠️ Partial`.

### 6.2 Copy Hook Scripts

1. `mkdir -p ${REPO_ROOT}/.claude/hooks/`
2. Copy 5 hooks (exclude `namespace-hint.sh` — plugin-only):

   | Hook | Event | Matcher | Purpose |
   |------|-------|---------|---------|
   | `pre-edit-guard.sh` | PreToolUse | Edit\|Write | Block editing .env/.git |
   | `post-edit-format.sh` | PostToolUse | Edit\|Write | Auto-format + track changes |
   | `post-tool-review-state.sh` | PostToolUse | Bash\|mcp__codex__codex\|mcp__codex__codex-reply | Parse review results |
   | `stop-guard.sh` | Stop | — | Check review + precommit completed |
   | `post-compact-auto-loop.sh` | SessionStart | compact | Re-inject auto-loop rules after compaction |

3. `chmod +x` each installed script.
4. Conflict strategy: same as Phase 5.2 (install new / skip identical / warn on conflict).

### 6.3 Merge Hook Definitions into Settings

Target: `${REPO_ROOT}/.claude/settings.json`

Hook definition mapping (uses `$CLAUDE_PROJECT_DIR` for portability):

```json
{
  "hooks": {
    "PreToolUse": [
      {"matcher": "Edit|Write", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/pre-edit-guard.sh"}]}
    ],
    "PostToolUse": [
      {"matcher": "Edit|Write", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-edit-format.sh"}]},
      {"matcher": "Bash|mcp__codex__codex|mcp__codex__codex-reply", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-tool-review-state.sh"}]}
    ],
    "Stop": [
      {"matcher": "", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/stop-guard.sh"}]}
    ],
    "SessionStart": [
      {"matcher": "compact", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-compact-auto-loop.sh"}]}
    ]
  }
}
```

> **Note**: Environment variables (including `STOP_GUARD_MODE`) are configured in **Phase 6.7** (independent of hook installation). Phase 6.3 only handles hook definition merging.

Merge strategy:
- Read existing settings file (create `{}` if not exists)
- **Legacy migration**: scan for bare `.claude/hooks/<name>.sh` paths → upgrade to `"$CLAUDE_PROJECT_DIR"/.claude/hooks/<name>.sh`
- For each event: append-only merge (skip if same command path exists)
- **Coexistence detection**: if `hooks/hooks.json` exists at repo root (= plugin source repo), warn that plugin hooks and installed hooks may coexist. Runtime arbitration handles dedup automatically
- Write updated settings back (hook definitions only — env vars deferred to Phase 6.7)

### 6.4 Output Hooks Report

```markdown
## Hooks Install Report

**Source**: <plugin-hooks-path>
**Scripts**: <repo-root>/.claude/hooks/
**Settings**: <repo-root>/.claude/settings.json

| Hook | Script | Settings | Status |
|------|--------|----------|--------|
| pre-edit-guard.sh | ✅ Copied | ✅ Added | Installed |
| ... | ... | ... | ... |

**Installed**: N / **Skipped**: M / **Conflicts**: K
```

---

## Phase 6.5: Install Scripts

**Skip if**: `--lite` or `--detect-only`.

### 6.5.1 Locate Plugin Scripts Directory

Same 3-level fallback as Phase 5.1, but search for `scripts/precommit-runner.js`:

1. `Glob: ~/.claude/plugins/**/sd0x-dev-flow/scripts/precommit-runner.js`
2. `Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/scripts/precommit-runner.js`
3. Plugin-relative fallback: `@scripts/precommit-runner.js`

**Not found** → warn + skip Phase 6.5. Phase 7 will report `⚠️ Partial`.

### 6.5.2 Copy Scripts

1. `mkdir -p ${REPO_ROOT}/.claude/scripts/lib`
2. Copy 3 scripts:

| Script | Purpose | Dependencies |
|--------|---------|--------------|
| `precommit-runner.js` | Precommit runner for `/precommit`, `/precommit-fast` | `lib/utils.js` |
| `verify-runner.js` | Verify runner for `/verify` | `lib/utils.js` |
| `lib/utils.js` | Shared utilities | None |

3. Conflict strategy: same as Phase 5.2.

| Scenario | Action |
|----------|--------|
| File does not exist | Install |
| File exists, content identical | Skip |
| File exists, content differs | Skip + warn as conflict |

### 6.5.3 Update Manifest

1. Read `.sd0x/install-state.json` (create `{}` if not exists)
2. Read plugin version from `.claude-plugin/plugin.json` or `package.json`
3. Update: `schema_version: 1`, `installed_at`, `plugin_version`, `scripts` key
4. Compute hash per file: `git hash-object --no-filters .claude/scripts/<name>`
5. Preserve all existing top-level keys (e.g. `rules`, `hook_scripts`, and any unknown keys)
6. Write back to `.sd0x/install-state.json`

### 6.5.4 Output Scripts Report

```markdown
## Scripts Install Report

**Source**: <plugin-scripts-path>
**Target**: <repo-root>/.claude/scripts/

| Script | Status |
|--------|--------|
| precommit-runner.js | Installed/Skipped/Conflict |
| verify-runner.js | Installed/Skipped/Conflict |
| lib/utils.js | Installed/Skipped/Conflict |

**Installed**: N / **Skipped**: M / **Conflicts**: K
```
