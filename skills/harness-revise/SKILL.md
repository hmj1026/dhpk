---
name: harness-revise
description: 'Trim and validate the project harness (.claude/, .gemini/, or .codex/). Detects the active environment and ensures consistency, hygiene, and trigger preservation. Use when: harness audit requested, after major rule additions, or periodic maintenance. Not for: business code review. Output: inventory snapshot, gap list with severity, proposed fixes, validation results.'
allowed-tools: 'Read, Edit, Write, Grep, Glob, Bash(jq:*), Bash(grep:*), Bash(find:*), Bash(wc:*), Bash(bash:*), Bash(git:*), Bash(ls:*), Bash(cat:*), Bash(chmod +x:*), Bash(rm:*)'
---

# Harness Revise Skill

Methodology to trim, deduplicate, and validate the project harness without regressing trigger semantics. Supports Multiple LLM Environments (Claude, Gemini, Codex).

## Trigger

- "harness check", "harness audit", "harness revise", "harness trim"
- "檢查 harness", "harness 設定優化"
- After: large rule/skill additions, agent renames, hook reshuffles

## When to Use

- 當使用者想要檢視當前環境的harness配置，並且希望優化或修正其中的問題時。
- 定期維護，確保harness的健康和效率。

## When NOT to Use

- 不涉及harness的業務邏輯或產品代碼修改。
- 單純的業務功能開發或bug修復。

## Workflow

### Phase 0 — Detection

Before proceeding, identify the active harness directory and its primary rule file.

1. **Contextual Hint**: Identify which environment is currently providing the session's instructions. When invoked by Claude Code through `/harness-revise`, set `[HARNESS_DIR]=.claude` even if `.gemini/` or `.codex/` also exists.
2. **Auto-Detect**: If there is no active-environment hint, check for `.claude/`, `.gemini/`, or `.codex/`. If multiple exist, require explicit `--dir` (scripts will error with `[error] Multiple harness dirs found`).
3. **Set Variables**: Mentally set `[HARNESS_DIR]` (e.g., `.claude`), `[MAIN_RULE]` (e.g., `CLAUDE.md`), and `[SKILL_DIR]`.

Use the skill directory as the source of truth for scripts. In Claude Code, `CLAUDE_SKILL_DIR` may be available; otherwise use the repo-relative cross-LLM location:

```bash
SKILL_DIR="${CLAUDE_SKILL_DIR:-.agents/skills/harness-revise}"
```

### Phase 1 — Baseline (deterministic, scripts only)

Run all three scripts from the skill folder. Pass the detected harness directory.

```bash
# Example for Claude
bash "$SKILL_DIR/scripts/harness-inventory.sh" --dir .claude
bash "$SKILL_DIR/scripts/harness-scenarios.sh" --dir .claude
bash "$SKILL_DIR/scripts/test-harness.sh" --dir .claude
```

Acceptance gate before proposing fixes:
- `harness-scenarios.sh` must report `FAIL=0` (target ceiling; new environments like Gemini may start with failures representing gaps).
- `test-harness.sh` must report `PASS: [Target Count]` (e.g., 71/71 for Claude with `--dir .claude`; SKIP entries for T5.4/T9.3 are acceptable).
- `harness-inventory.sh` reports inform the report; handles missing `memory.md` or platform-specific configs.

If either suite fails before any fix is proposed, **stop and report the existing regression** — do not stack new changes on a broken baseline.

### Phase 2 — Gap Identification (AI judgment using gap taxonomy)

Walk the inventory output against the gap taxonomy below.

#### Gap taxonomy (canonical, ID-stable)

| ID | Symptom | Fix pattern |
|----|---------|-------------|
| **G1** | `post-edit-remind.sh` re-triggers on agent artifacts | Skip `[HARNESS_DIR]/artifacts/*` early |
| **G2** | Hooks parse JSON via `jq` only | Add `python3` fallback for portability |
| **G3** | `stop-review-reminder.sh` output is too verbose | Add condensed mode; default condensed unless `VERBOSE=1` |
| **G4** | `settings.json` (or config.toml) contains loose command wildcards | Refine to explicit matchers or `<verb>:*` colon-prefix |
| **G5** | Sentinel gates bypassed by terminal `git commit` | Add `.git/hooks/pre-commit` wrapper (mirroring harness hooks) |
| **G6** | Rules reference deleted skills | `harness-inventory.sh` `dangling_skills` count > 0 — prune rules |
| **G7** | `pre-bash-guard.sh` lacks coverage for dangerous operations | Extend with `rm -rf /`, `curl | sh` patterns |
| **G8** | `test-harness.sh` uses outdated hook payload formats | Update to JSON payload contract: `{tool_input:{file_path}}` |
| **G9** | Cosmetic `echo` or dead-code in settings/hooks | Prune redundant entries from `settings.json` / `config.toml` |
| **G10** | Status line lacks sentinel badge | Ensure `statusline.sh` surfaces pending sentinels (e.g. `⚠2pending`) |
| **G11** | Hooks fire on unrelated files (e.g. CRLF fix on binary/code) | Narrow matchers to relevant extensions (e.g. `*.sh`) |
| **G12** | Trigger/Guard map duplication | Centralize logic in hooks; rules point to hooks as SSOT |
| **G13** | Monolithic `memory.md` overlaps module rules | Prune `memory.md` to a lightweight index/stub |

### Phase 3 — Proposal & User Approval

Produce a ranked table:

```md
| ID | Severity | Effort | Location | Action |
|----|----------|--------|----------|--------|
| G1 | MED | 4 lines | [HARNESS_DIR]/hooks/post-edit-remind.sh | Add artifacts skip |
| G9 | LOW | 2 lines | [HARNESS_DIR]/settings.json | Prune cosmetic echo |
```

Wait for user approval before editing.

### Phase 4 — Apply Fixes (with per-fix verification)

For each approved fix:
1. Read the target file.
2. Apply minimal change.
3. Re-run the matching deterministic script (with `--dir [HARNESS_DIR]`).
4. Revert and re-plan on regression.

### Phase 5 — Final Validation

After all fixes:

```bash
bash "$SKILL_DIR/scripts/harness-inventory.sh" --dir [HARNESS_DIR]
bash "$SKILL_DIR/scripts/harness-scenarios.sh" --dir [HARNESS_DIR]
bash "$SKILL_DIR/scripts/test-harness.sh" --dir [HARNESS_DIR]
```

Then spawn the `code-reviewer` agent on the diff scope.

## Output Contract

Include, in order:
1. **Active Harness**: Detected directory and main rule file.
2. **Baseline numbers**: metrics before optimization.
3. **Gap table**: using IDs G1-G13.
4. **Fixes applied**: file + line range.
5. **Post-fix numbers**: including deltas.
6. **Code-reviewer verdict**.
7. **Deferred items**.

## Anti-Patterns

- Hardcoding `.claude/` when running in `.gemini/` or vice-versa.
- Modifying business code instead of harness assets.
- Inventing new IDs without updating the taxonomy.
- Translating zh-TW in project communication files (PRs/commits).
