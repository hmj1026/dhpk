# Phase 5: Install Rules + Backfill CLAUDE.md

Full detail for `/project-setup` Phase 5. **Skip if**: `--no-rules` or `--lite` or `--detect-only`.

`/project-setup` uses **fresh-install semantics** (install new / skip identical / warn on conflict; no smart merge). For smart merge (section merge, legacy migration, `--legacy-strategy`), run `/install-rules` directly.

## 5.1 Locate Plugin Rules Directory

Find the plugin's `rules/` directory using this priority (short-circuit on first match):

1. **Glob search** — search known Claude plugin locations:

   ```
   Glob: ~/.claude/plugins/**/sd0x-dev-flow/rules/auto-loop.md
   Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/rules/auto-loop.md
   ```

2. **Plugin-relative fallback** — try reading `@rules/auto-loop.md` to confirm accessibility. If readable, derive the rules directory.
3. **Not found** → **hard error for this phase** (do not silently skip). Output explicit failure with remediation steps:

   ```
   ⛔ Rule source not found. Auto-loop rules cannot be installed.

   Remediation (choose one):
   1. Install the plugin: /plugin marketplace add sd0xdev/sd0x-dev-flow && /plugin install sd0x-dev-flow@sd0xdev-marketplace
   2. Copy rules manually from a machine that has the plugin installed
   3. Re-run with --no-rules to skip (rules layer will be missing)
   ```

   Then skip Phase 5 and continue to Phase 6. Phase 7 will report this as `⚠️ Partial`.

## 5.2 Copy Rules

1. `mkdir -p ${REPO_ROOT}/.claude/rules/`
2. Copy all 11 managed rules:

   | Rule | Purpose |
   |------|---------|
   | `auto-loop.md` | Auto review loop enforcement |
   | `codex-invocation.md` | Codex independent research requirement |
   | `fix-all-issues.md` | Zero tolerance for unfixed issues |
   | `framework.md` | Framework conventions |
   | `testing.md` | Test structure and requirements |
   | `security.md` | OWASP security checklist |
   | `git-workflow.md` | Git branch and commit conventions |
   | `logging.md` | Structured logging standards |
   | `docs-writing.md` | Documentation writing conventions |
   | `docs-numbering.md` | Document numbering scheme |
   | `self-improvement.md` | Self-improvement loop |

3. Create override template (unmanaged, not manifest-tracked):
   - `auto-loop-project.md` — user-owned override template (see Phase 3.6 in `/install-rules`)

4. Conflict strategy:

   | Scenario | Action |
   |----------|--------|
   | File does not exist | **Install** |
   | File exists, content identical | **Skip** |
   | File exists, content differs | **Skip** + warn as conflict |

5. After copying, collect hashes and write manifest:
   - Compute `git hash-object --no-filters` for each managed rule (installed + already-identical skipped)
   - Read `.sd0x/install-state.json` (create `{}` if not exists)
   - Update `schema_version: 1`, `installed_at`, `plugin_version` (source priority: `.claude-plugin/plugin.json` → `package.json` → `"unknown"`), `rules` key — hash for each file in managed state (both newly installed and already-identical). Structure: `rules[filename] = { "hash": "<sha1>" }`
   - Preserve ALL other top-level keys from existing manifest (e.g. `hook_scripts`, `scripts`, `sd0x_version`, `agents_md_hash`, `hooks_installed` — do NOT drop unknown keys)
   - Write updated manifest via `Write` tool

> **Note**: After rule installation, `/install-rules` automatically creates `auto-loop-project.md` (user-owned override template) if it doesn't exist. See `skills/install-rules/SKILL.md`.

## 5.3 Backfill CLAUDE.md (Closed-Loop Guarantee)

Ensure `.claude/CLAUDE.md` contains `@rules/` references so the auto-loop engine can activate:

1. Grep `.claude/CLAUDE.md` for `@rules/auto-loop.md`
2. **Found** → check if `@rules/auto-loop-project.md` also present:
   - **Both present** → skip (fully configured)
   - **`auto-loop.md` present, `auto-loop-project.md` missing** → insert `- @rules/auto-loop-project.md -- Project-specific auto-loop overrides (user-owned)` after `auto-loop.md` line
3. **Not found but file exists** → append `## Rules` block at end of file (12 `@rules/` references (11 managed + 1 override template) from `CLAUDE.template.md` `## Rules` section)
4. **File does not exist** (edge case: Phase 3 was skipped) → extract from `CLAUDE.template.md`: `## Required Checks` through `### Auto-Loop Rule` sections + `## Rules` section → create minimal `.claude/CLAUDE.md`

When extracting from template, remove ecosystem block markers and leave unresolved placeholders as `{PLACEHOLDER}`.

## 5.4 Output Rules Report

```markdown
## Rules Install Report

**Source**: <plugin-rules-path>
**Target**: <repo-root>/.claude/rules/

| Rule | Status |
|------|--------|
| auto-loop.md | ✅ Installed |
| ... | ... |

**Installed**: N / **Skipped**: M / **Conflicts**: K
**Manifest**: .sd0x/install-state.json
**CLAUDE.md backfill**: ✅ @rules/ references present
```
