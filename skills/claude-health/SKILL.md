---
name: claude-health
argument-hint: '[--fix]'
description: 'Claude Code config health check + plugin sync. Use when: auditing .claude/ structure, checking naming, verifying hook setup, detecting plugin version drift, syncing installed assets. Not for: skill quality (use skill-health-check), code review (use codex-code-review). Output: health report + fix recommendations.'
allowed-tools: 'Read, Grep, Glob, Bash(ls:*), Bash(find:*), Bash(wc:*), Bash(du:*), Bash(rm:*), Bash(git:*)'
context: fork
---

# Claude Health Check

## Trigger

- Keywords: health check, .claude check, config audit, lint .claude, claude health, plugin sync, version drift, upgrade check, doctor

## When NOT to Use

- Code review (use `/codex-review-fast`)
- Doc review (use `/codex-review-doc`)
- Security review (use `/codex-security`)
- Skill quality audit (use `/skill-health-check`)

## Scope

| Argument | Description |
|----------|-------------|
| `--scope hygiene` | Only run C1-C7 hygiene checks |
| `--scope sync` | Only run S1-S3 sync checks |
| `--scope all` | Run both modules (**default**) |

## Workflow

```
[--scope] → Select modules → Scan → Classify → Report → Fix suggestions
               │                                  │
       ┌───────┴───────┐                     P0/P1/P2
       ▼               ▼                    + fix commands
  Hygiene (C1-C7)  Sync (S1-S3)
```

1. **Parse args** — resolve `--scope` (default `all`) and the optional fix tier (`--fix-safe` / `--fix`; mutually exclusive, error if both).
2. **Hygiene module (C1-C7)** — run the 7 checks summarized below. Exact bash, `.gitignore` required-item table, and the command-skill exclude list: `references/hygiene-checks.md`.
3. **Sync module (S1-S3)** — version, component classification, settings (summarized below). Full state machine, managed inventory, override safeguards, and fix delegation: `references/plugin-sync.md`.
4. **Classify** each finding P0/P1/P2 and **report** with targeted fix commands (see Output). Mutations only when a fix tier is set, and only via `/install-*` delegation.

### Hygiene Module — Checks (7 items)

| # | Check | Criteria |
|---|-------|----------|
| 1 | Junk files (`.DS_Store`, `*.zip`, `.tmp*`) | Any exists → P1 |
| 2 | `.claude/.gitignore` exists | Missing → P1 |
| 3 | `.gitignore` completeness | Missing required item → P2 |
| 4 | Naming consistency (`reference` vs `references`) | Inconsistent → P2 |
| 5 | README count sync | Mismatch → P2 |
| 6 | Command-Skill pairing | Core skill missing command → P1 |
| 7 | Cache size (`du -sh .claude/cache/`) | > 50M → P2 |

> Per-check bash + tables: `references/hygiene-checks.md`.

### Sync Module — Checks (S1-S3)

> Runs when `--scope sync` or `--scope all` (default).

| Check | Focus | Key severities |
|-------|-------|----------------|
| S1 | Manifest + plugin version drift | Missing/unparseable manifest, version mismatch → P1; schema/`MANIFEST_GAP` → P2 |
| S2 | Component classification (rules/hooks/scripts) | `MISSING`, `OUTDATED` → P1; `CONFLICT`, `LEGACY`, `MANIFEST_GAP` → P2 |
| S2.5 | Override safeguards (`*-project.md`) | Policy contradiction / missing reference → P1; drift / wrong-layer / dup heading → P2 |
| S3 | Settings compatibility (both settings files) | Missing hook entry → P1; legacy paths / orphans / guard mode → P2 |

> Full mechanics — plugin-version resolution, the 8-state S2 classification table, the 23-file managed inventory, override-drift detection, settings precedence, and the **Fix Tiers + delegation** matrix — live in `references/plugin-sync.md`.

## Output

```markdown
# .claude/ Health Check Report

## Hygiene Summary (C1-C7)

| Item | Status | Notes |
|------|--------|-------|
| Junk files | ✅/⛔ | ... |
| .gitignore | ✅/⛔ | ... |
| Naming consistency | ✅/⛔ | ... |
| README count | ✅/⛔ | ... |
| Command-Skill | ✅/⛔ | ... |
| Cache size | ✅/⛔ | ... |

## Sync Summary (S1-S3)

### S1: Version
| Check | Status | Detail |
|-------|--------|--------|
| Manifest | ✅/⛔ | Found / Missing |
| Plugin version | ✅/⛔ | 2.0.3 == 2.0.3 / 1.8.12 → 2.0.3 |
| Manifest keys | ✅/⛔ | Complete / Missing: hook_scripts, scripts |

### S2: Component Status
| File | Category | Status | Action |
|------|----------|--------|--------|
| auto-loop.md | Rules | OUTDATED | `/install-rules auto-loop` |
| security.md | Rules | OK | — |
| stop-guard.sh | Hooks | MISSING | `/install-hooks stop-guard` |
| ... | ... | ... | ... |

### S3: Settings Compatibility
| Check | Status | Detail |
|-------|--------|--------|
| Hook paths | ✅/⛔ | Modern / Legacy found |
| Guard mode | ✅/⛔ | strict / Missing |
| Entry integrity | ✅/⛔ | All matched / N missing |
| Orphan entries | ✅/⛔ | None / N orphans |

## Statistics

| Category | Count |
|----------|-------|
| Commands | N |
| Skills | N |
| Rules | N (installed) / N (managed) |
| Hooks | N |

## Issues

### P1
- [Issue] → [Fix recommendation / command]

### P2
- [Issue] → [Fix recommendation]

## Gate
✅ All Pass / ⛔ N issues need fixing
```

## Verification

- [ ] Hygiene: All 7 checks executed (when scope includes hygiene)
- [ ] Sync: S1-S3 checks executed (when scope includes sync)
- [ ] Each check has clear ✅/⛔ status
- [ ] P1 issues have specific fix commands
- [ ] S2 classification covers all 23 managed files
- [ ] Fix delegation uses targeted file names (not `--all`)

## References

- `references/hygiene-checks.md` — read when running C1-C7: exact bash, `.gitignore` required-item table, command-skill exclude list
- `references/plugin-sync.md` — read when running S1-S3: version resolution, S2 classification states, managed inventory, override safeguards, settings checks, and `--fix` / `--fix-safe` delegation
- `references/usage-examples.md` — read for invocation patterns and the action each triggers
- `references/best-practices.md` — read for best practices on .claude/ directory structure
