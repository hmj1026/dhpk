# Canonical trap-sheet disposition

Apply evidence for `rewrite-agent-traps-for-agents`. Canonical count: 35 files
(4 `_common/` + 31 per-agent stack sheets). Generated Codex/Cursor mirrors are
not disposition rows. `frontend-reviewer` stays on `modules/js/references/`;
there is no `agent-traps/frontend-reviewer/` directory.

Loader SHA-256 (task 2.3; must match `agent-traps/_common/trap-sheet-loader.md`):
`3a91e43ff71735426254494e34460df034f1c75ef81995115bd5a31df43ee77b`

| Path | Disposition | SSOT / notes |
|---|---|---|
| `_common/trap-sheet-loader.md` | already-compliant | Detection-order SSOT. Not edited. |
| `_common/prompt-defense.md` | already-compliant | Untrusted-diff SSOT. Pointer only elsewhere. |
| `_common/build-resolver-skeleton.md` | already-compliant | Shared 3-attempt resolver SSOT. |
| `_common/cli-prompt-composition.md` | updated | Baselines 0.147.0 / `AGY_VERIFIED_BASELINE` 1.1.13. Wrapper degrade path landed. |
| `code-reviewer/php.md` | updated | Floor/banned table → `modules/php-5.6/references/coding-style.md`. LSP exceptions kept. |
| `code-reviewer/js.md` | updated | Trigger/Action/Non-apply rows; security → `security-reviewer/js.md`. |
| `code-reviewer/vue.md` | updated | Vue-specific rows; generic TS → `code-reviewer/js.md`. |
| `code-reviewer/laravel.md` | updated | Laravel-only traps; PHP floor → `code-reviewer/php.md`. |
| `code-reviewer/yii.md` | updated | Yii-only traps; PHP floor → coding-style pointer. |
| `code-reviewer/python.md` | updated | Python code-reviewer traps; security → `security-reviewer/python.md`. |
| `code-reviewer/swift.md` | updated | Swift code-reviewer traps with Non-apply bounds. |
| `code-reviewer/fastapi.md` | updated | FastAPI-only traps; DB/security pointed at those agents. |
| `security-reviewer/php.md` | already-compliant | OWASP pointer to `skills/dhpk-php-runtime-router/references/agent-extracts/security-owasp-examples.md`; rows given Non-apply bounds. |
| `security-reviewer/js.md` | updated | Executable rows + Non-apply bounds. |
| `security-reviewer/python.md` | updated | Executable rows + Non-apply bounds. |
| `security-reviewer/yii.md` | updated | Unique Yii security; no OWASP paste. |
| `security-reviewer/fastapi.md` | updated | Unique FastAPI security. |
| `security-reviewer/ios.md` | updated | Unique iOS security. |
| `database-reviewer/postgres.md` | updated | Executable rows + Non-apply bounds. |
| `database-reviewer/yii.md` | updated | Unique Yii DB traps. |
| `database-reviewer/fastapi.md` | updated | Unique FastAPI DB traps. |
| `database-reviewer/ios.md` | updated | Unique iOS DB traps. |
| `tdd-guide/php.md` | updated | Stale `.claude/rules/php/testing.md` → `modules/phpunit-5.7/references/testing.md`. |
| `tdd-guide/js.md` | updated | Executable rows + Non-apply bounds. |
| `tdd-guide/python.md` | updated | Executable rows + Non-apply bounds. |
| `tdd-guide/swift.md` | updated | Executable rows + Non-apply bounds. |
| `migration-reviewer/yii.md` | updated | Unique Yii migration traps. |
| `migration-reviewer/ios.md` | updated | Unique iOS migration traps. |
| `performance-analyzer/frontend.md` | updated | Flag/Fix → Trigger/Action/Non-apply. |
| `performance-analyzer/swift.md` | updated | Unique Swift perf traps. |
| `performance-analyzer/yii.md` | updated | Unique Yii perf traps; stale `.claude/rules/php/*` replaced. |
| `silent-failure-hunter/php.md` | updated | Unique PHP silent-failure traps. |
| `silent-failure-hunter/swift.md` | updated | Unique Swift silent-failure traps. |
| `e2e-runner/playwright.md` | updated | Unique Playwright traps. |
| `architect/yii.md` | updated | Stale `.claude/rules/php/coding-style.md` → `modules/php-5.6/references/coding-style.md`. |

Count: 35/35. Zero omitted.
