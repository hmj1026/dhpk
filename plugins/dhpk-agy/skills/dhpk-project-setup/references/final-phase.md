# Phase 7: Final Verification & Output Formats

Full output templates for `/dhpk:dhpk-project-setup` Phase 7. SKILL.md keeps the closed-loop check table; this file holds the verbose output block and all status variants.

## Closed-Loop Check (reference copy)

| Condition | Check | Required |
|-----------|-------|----------|
| CLAUDE.md behavior text | `Required Checks` section exists | ✅ |
| `@rules/` references | `@rules/execution-policy.md` in `.claude/CLAUDE.md` | ✅ |
| Rule files | `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` accessible | ✅ |
| Hook enforcement | `stop-guard` in `.claude/settings.json` | ✅ |
| Script runners | `.claude/dhpk/skills/precommit/scripts/precommit-runner.js` and `.claude/dhpk/skills/repo-verify/scripts/verify-runner.js` exist | ✅ (unless `--lite` or `--detect-only`) |
| Guard mode | `env.STOP_GUARD_MODE` = `strict` in target settings file | ✅ (unless `--guard-mode warn`) |
| Auto-compact window | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` in target settings file | ✅ (1M model only) |

## Final Output Block

```markdown
## Project Setup Complete

| Phase | Status |
|-------|--------|
| Detection | ✅ Framework: X, PM: Y, DB: Z |
| CLAUDE.md | ✅ Configured (0 remaining placeholders) |
| Rules | ✅ 4 shipped rules referenced by path |
| Hooks | ✅ Selected hook payload installed + settings merged |
| Scripts | ✅ 2/2 Skill runner trees installed with local helpers |
| Env Config | ✅ STOP_GUARD_MODE=strict, AUTO_COMPACT_WINDOW=320000 (1M) |

### Closed-Loop Status
✅ Auto-loop engine fully configured (strict mode)
(or ⚠️ Auto-loop engine configured (warn mode — stop-guard will not block))
(or ⚠️ Partial — missing: hooks (enforcement layer inactive))
(or ⚠️ Partial — missing: rules)
(or ⚠️ Partial — missing: scripts (runner not installed))
(or ℹ️ Auto-compact window not set — standard context model detected)

Host capability evidence is reported separately from fixture or static checks.
Until a supported Claude Host probe observes detection, rendering, confirmation,
and writes, the Host state remains `NOT_RUN`; a fixture PASS cannot upgrade it.

### Next Steps
- Run `/dhpk:dhpk-repo-intake` for a full project scan
- Use `HOOK_BYPASS=1` as emergency escape hatch
- Use `/install-rules --force` to upgrade rules later
```

## Detection-Only Output (`--detect-only`)

When `--detect-only` is set, Phases 3–6.7 are skipped. Output only the Phase 2 detection results table (9 auto-detected placeholders with `| Placeholder | Detected Value | Source |` columns) plus any manual placeholders noted as `manual`.

## Lite Output (`--lite`)

When `--lite` is set, only Phases 1–4 run. Output the CLAUDE.md configuration summary (placeholder values + remaining count) and note that rules / hooks / scripts / env layers were skipped.
