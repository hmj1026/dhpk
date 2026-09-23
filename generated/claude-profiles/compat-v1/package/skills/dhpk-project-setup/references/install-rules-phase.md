# Phase 5: Install Rules + Backfill CLAUDE.md

Full detail for `/dhpk:dhpk-project-setup` Phase 5. **Skip if**: `--no-rules` or `--lite` or `--detect-only`.

`/dhpk:dhpk-project-setup` uses **fresh-install semantics** (install new / skip identical / warn on conflict; no smart merge). For smart merge (section merge, legacy migration, `--legacy-strategy`), run `/install-rules` directly.

## 5.1 Locate Rule Data in the Explicit Artifact

When this phase installs a selected group, require the caller to supply
`--source-artifact <distribution-root>` and invoke the local
`scripts/install-project-assets.sh` adapter. The adapter reads the artifact's
`rules/` directory as data and never searches ambient Host locations or runs an
artifact installer. A missing artifact or selected payload is a hard non-pass
before target mutation. `--lite`, `--detect-only`, and `--env-only` do not need
an artifact because they skip this phase.

If the selected artifact has no rule payload, output explicit failure with
remediation steps:

   ```
   ⛔ Rule source not found. Rules cannot be installed.

   Remediation (choose one):
   1. Supply a distribution artifact containing the four selected rule files
   2. Re-run with `--no-rules` to skip (rules layer will be missing)
   ```

   Then skip Phase 5 and continue to Phase 6. Phase 7 will report this as `⚠️ Partial`.

## 5.2 Reference Rules (path-reference model)

dhpk ships exactly 4 rules under the selected artifact's `rules/` data. These
are **not copied** into the consumer repo — the Host procedure writes the
artifact-root path references into the consumer's `.claude/CLAUDE.md`.

1. The 4 shipped rules:

   | Rule | Purpose |
   |------|---------|
   | `anti-rationalization.md` | Anti-rationalization guardrails |
   | `execution-policy.md` | Execution policy enforcement |
   | `model-economics.md` | Model selection / cost economics |
   | `tool-routing.md` | Tool routing guidance |

2. Conflict strategy (applies to the `.claude/CLAUDE.md` reference lines, not to file copies):

   | Scenario | Action |
   |----------|--------|
   | Reference line does not exist | **Install** |
   | Reference line exists, content identical | **Skip** |
   | Reference line exists, content differs | **Skip** + warn as conflict |

3. After referencing, write manifest:
   - Read `.dhpk/install-state.json` (create `{}` if not exists)
   - If `.dhpk/install-state.json` is absent but a legacy `.sd0x/install-state.json` exists, read it (including any legacy `sd0x_version` key) to migrate forward, then write only the `.dhpk/` form (never write back to `.sd0x/`).
   - Update `schema_version: 1`, `installed_at`, `plugin_version` (source priority: `.claude-plugin/plugin.json` → `package.json` → `"unknown"`), `rules` key — record each of the 4 shipped rules as referenced. Structure: `rules[filename] = { "referenced": true }`
   - Preserve ALL other top-level keys from existing manifest (e.g. `hook_scripts`, `scripts`, `dhpk_version`, `agents_md_hash`, `hooks_installed` — do NOT drop unknown keys)
   - Write updated manifest via `Write` tool

## 5.3 Backfill CLAUDE.md (Closed-Loop Guarantee)

Ensure `.claude/CLAUDE.md` contains `@rules/` path-references to the 4 shipped rules so they activate:

1. Grep `.claude/CLAUDE.md` for `@rules/execution-policy.md`
2. **Found** → treat as fully configured (skip)
3. **Not found but file exists** → append `## Rules` block at end of file with 4 `${CLAUDE_PLUGIN_ROOT}/rules/` path-references (`anti-rationalization.md`, `execution-policy.md`, `model-economics.md`, `tool-routing.md`)
4. **File does not exist** (edge case: Phase 3 was skipped) → create a minimal `.claude/CLAUDE.md` containing a `## Rules` section with the 4 path-references

Leave unresolved placeholders as `{PLACEHOLDER}`.

## 5.4 Output Rules Report

```markdown
## Rules Install Report

**Source**: <plugin-rules-path>
**Target**: <repo-root>/.claude/CLAUDE.md (path-references, no local copies)

| Rule | Status |
|------|--------|
| anti-rationalization.md | ✅ Referenced |
| execution-policy.md | ✅ Referenced |
| model-economics.md | ✅ Referenced |
| tool-routing.md | ✅ Referenced |

**Installed**: N / **Skipped**: M / **Conflicts**: K
**Manifest**: .dhpk/install-state.json
**CLAUDE.md backfill**: ✅ @rules/ references present
```
