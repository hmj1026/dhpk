<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **dhpk** (11134 symbols, 14012 relationships, 229 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/dhpk/context` | Codebase overview, check index freshness |
| `gitnexus://repo/dhpk/clusters` | All functional areas |
| `gitnexus://repo/dhpk/processes` | All execution flows |
| `gitnexus://repo/dhpk/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Plugin development

This repo is the dhpk plugin source, not an installed consumer.

- **Change-goes-live flow**: source edits here do NOT affect an installed consumer until a version bump + reinstall (`claude plugin update dhpk@dhpk`, or a fresh install). For a faster dev loop, run Claude Code with `--plugin-dir` pointed at this source tree — live reload, no bump/reinstall cycle needed.
- **Validation gates**: `node scripts/ci/validate-plugin.js` (plugin.json path/registration integrity), `node scripts/ci/catalog.js --check all` (exact count claims), `node tests/run-all.js` (full test suite), `bash scripts/validate/validate-harness.sh` (route-table / hook wiring / sentinel integrity).
- **Sentinel/hook model**: post-edit hooks write `.claude/artifacts/sessions/.pending-*` sentinels; reviewers clear them via their Closing hook. See `rules/execution-policy.md` (SSOT) and `docs/hook-extension.md` for detail.
