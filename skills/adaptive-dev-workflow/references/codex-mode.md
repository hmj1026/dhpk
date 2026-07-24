# Codex Mode

只在使用者傳入 `--codex`，或需要選擇 Codex 下游命令時讀取本檔。

## Contract

- 預設只走 Claude + dhpk agents，不需要 Codex CLI/MCP。
- `--codex` 啟用 planning、實作與 review 的獨立第二意見；若 Codex 不可用，只警告一次並 fall back 到 codex-free。
- codex-free 路徑不得呼叫 `mcp__codex__*`；Codex 只能透過具備相應權限的 `codex-*` command 委派。
- 下游 `Next Command` 必須附上 `--codex`。

## Phase Mapping

| Phase | Codex-free（預設） | `--codex` |
|------|--------------------|-----------|
| Planning（跨模組 / DDD） | `dhpk:architect` agent | `/codex-architect` |
| Planning（根因未知） | `bug-investigation` skill | `/codex-brainstorm` 或 `code-investigate` |
| 實作 hand-off | `dhpk:bug-fix` / `dhpk:feature-dev` | 同上 `… --codex` |
| Test gate | `dhpk:tdd-guide` agent + `/check-coverage` | `/codex-test-review` |
| Review gate | `dhpk:code-reviewer`（`/review-pending`） | `/codex-review-fast` |
| Security gate | `dhpk:security-review`（inline OWASP） | `/codex-security` |

Planning、post-implementation 與 next-command 的 codex-free 表格是預設路徑；`CODEX=on` 時依本表替換對應步驟。
