---
name: pr-review
argument-hint: '[--base <branch>]'
description: 'PR self-review workflow — review changes for correctness/security/perf, produce checklist, scan for unrelated changes in squash merges. Use when reviewing your own branch before opening a PR, after a squash merge needs hygiene check, or when running `/pr-review` command. Not for: single-file code-only review (use `/code-review` or `code-reviewer`), dedicated DB or security audits (use `database-reviewer` / `security-reviewer`), or non-PR exploratory reading (use `code-explore`). Output: review notes + PR checklist + an explicit mergeable / needs-revision gate. Includes advisory scan for squash merge unrelated changes per `squash-merge-hygiene` capability.'
---

# pr-review

## When to use

- 自審你的 feature branch 在開 PR 前（基本 correctness / security / perf check）
- 對既有 PR 跑 hygiene scan（特別是 squash merge → unrelated changes）
- 配合 `/pr-review` slash command 自動觸發（command 本身為 thin wrapper）

## When NOT to Use

- 純看 code 不開 PR 的場景 → 用 `/code-review` / `code-reviewer-<your-project>`
- DB query 專門審 → 用 `database-reviewer-<your-project>`
- Security 專門審 → 用 `security-reviewer-<your-project>`

## Workflow

### Step 1 — Risk assessment

跑 `/risk-assess --mode fast` 取得當前未提交變更的風險分數。若 High+ 則 escalate 為 `--mode deep`。

### Step 2 — Code-level review

逐維度 audit：

1. **Correctness** — logic、edge cases、error handling
2. **Security** — XSS / SQL injection / authn / authz / secret leakage
3. **Performance** — N+1、重複 query、大 payload、binary-search opportunities

對應 <your-project> `.claude/rules/`：
- `php/coding-style.md` PHP 5.6 / Yii 1.1 限制
- `php/security.md` OWASP 對照
- `php/patterns.md` Repository / queryBuilder 優先
- `frontend.md` 前端 AJAX wrapper / E2E 慣例

### Step 3 — PR hygiene scan（squash merge 用）

若本次將以 squash merge 進 develop / main，**MUST** 跑 unrelated-changes 掃描：

```bash
bash .claude/skills/pr-review/scripts/check-unrelated-changes.sh <pr-number>
```

腳本行為（spec `squash-merge-hygiene`）：
- 非 squash → 印 `[skip] not a squash merge` 並退出 0
- squash + PR description 含 `## Unrelated Changes` → 印 `[ok]` 並退出 0
- squash + PR description **缺** `## Unrelated Changes` → 印 warning + 列疑似 unrelated 檔案集合；**退出仍為 0**（advisory，不擋 merge）

警告觸發時，作者 SHOULD 在 PR description 加 `## Unrelated Changes` 段，依以下格式列出：

```markdown
## Unrelated Changes

### <分群標題>（e.g. "VoucherNumberCodecService refactor"）

- **Files**: `<path1>` (+N -M), `<path2>` (+N -M)
- **Why mixed in**: <原因>
- **Reviewer**: @<reviewer-id> / `<reviewer-agent>`
- **vm1 smoke 範圍擴大**: <範圍>
```

backfill 範例：在 `docs/` 之下開一個對應的 refactor 子目錄（命名例如 `docs/refactor-<area>/squash-<sha>-unrelated-reviews.md`）。

### Step 4 — Discover new rules

若審查中發現可推廣的規律：

- 永久通用 → 寫到 `.claude/rules/*.md`
- 一次性 / 個案 → 寫到 `MEMORY.md` 或 `CLAUDE.md`
- 工具化 → 寫 hook 或 skill

## Output template

```markdown
## Review Notes

- <findings 含 file_path:line_number>

## PR Checklist

- [ ] Risk assessment: Low/Medium（High+ 已 acknowledge）
- [ ] Tests pass
- [ ] No breaking changes
- [ ] Docs updated
- [ ] Squash hygiene: `## Unrelated Changes` 段已列（squash merge 情境）

## Rules Update (if any)

- <proposed patch>

## Gate

✅ Mergeable / ⚠️ Needs revision / ⛔ Block — <one-line justification>
```

Per `execution-policy.md` → *Review output gate*, every review reply MUST end with this explicit
gate: a symbol (✅ / ⚠️ / ⛔), a status word (Mergeable / Needs revision / Block), and a one-line
justification. The reader sees the verdict first.

## Verification

- [ ] Risk score obtained（High+ 已升級為 `--mode deep`）
- [ ] 三維度（correctness / security / performance）皆已逐項 audit
- [ ] squash merge 情境已跑 `check-unrelated-changes.sh` 掃描
- [ ] 輸出以明確 gate 結尾（✅ Mergeable / ⚠️ Needs revision / ⛔ Block + 一句理由）

## Rule sources

- Project `.claude/rules/execution-policy.md` if present, else `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`, "Git pipeline" — squash merge hard rule
- Project `.claude/rules/execution-policy.md` if present, else `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`, "Review output gate" — the mandatory ✅/⚠️/⛔ verdict
- 專案內任何 squash-merge-hygiene capability spec（依專案 OpenSpec 命名而定）
- 專案 `docs/refactor-<area>/squash-<sha>-unrelated-reviews.md` — backfill 範例
