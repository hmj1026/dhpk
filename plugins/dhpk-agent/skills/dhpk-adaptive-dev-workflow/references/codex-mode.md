# Codex Mode

只在使用者傳入 `--codex`，或需要選擇 Codex 下游命令時讀取本檔。Claude
預設 discovery 使用實體化的 `minimal` profile；`full` 與 `compat-v1` 必須
明確 opt-in，本檔不會擴大預設 discovery surface。

## Contract

- 預設只走 Claude + dhpk agents，不需要 Codex CLI/MCP。
- `CODEX=on` 與 `--codex` 是 legacy、單次 session 的 MCP-peer interface；仍保留於 compatibility window，但不是 CLI `codex exec`、`--worker=codex`、`--reasoner=codex` 或外部 `codex app-server` plugin 的別名。
- `--codex` 啟用 legacy planning、實作與 review 的獨立第二意見；若 MCP peer 不可用，只警告一次並 fall back 到 codex-free。新流程請使用預設 Codex-free route，或明確選取保留的 CLI worker/reasoner backend。
- codex-free 路徑不得呼叫 `mcp__codex__*`；Codex 只能透過具備相應權限的 `codex-*` command 委派。
- 下游 `Next Command` 必須附上 `--codex`。

## Phase Mapping

| Phase | Codex-free（預設） | `--codex` |
|------|--------------------|-----------|
| Planning（跨模組 / DDD） | `dhpk:architect` agent | `/dhpk:dhpk-codex-architect` |
| Planning（根因未知） | `dhpk-root-cause-investigation` skill | `/dhpk:dhpk-codex-architect "<question>" --mode adversarial` 或 `/dhpk:dhpk-codebase-exploration --dual` |
| 實作 hand-off | Adaptive Feature / Bug branch | 同上 `… --codex` |
| Test gate | `dhpk:tdd-guide` agent + `/check-coverage` | `/dhpk:codex-test-review`（frozen `explicit-only`） |
| Review gate | `dhpk:code-reviewer`（`/review-pending`） | `/dhpk:codex-review-fast`（frozen `explicit-only`） |
| Security gate | `dhpk:dhpk-security-review`（inline OWASP） | `/dhpk:codex-security`（frozen `explicit-only`） |

Planning、post-implementation 與 next-command 的 codex-free 表格是預設路徑；
legacy `CODEX=on`／`--codex` 只有在使用者明確 opt-in 時才依本表替換對應步驟。

凍結的 MCP surface 正好是 9 個 skill：`dhpk-codex-architect`、
`dhpk-codex-implement`、`dhpk-change-review`（inventory ID
`codex-code-review`）、`dhpk-doc-review`、`dhpk-test-review`、
`dhpk-codebase-exploration`、`dhpk-feature-verify`、`dhpk-issue-analyze`、
`dhpk-feasibility-study`；以及 8 個 command：`codex-review`、
`codex-review-branch`、`codex-review-doc`、`codex-review-fast`、
`codex-security`、`codex-test-gen`、`codex-test-review`、`review-spec`。
這些 entry 皆為 `explicit-only`，仍可用 exact name 直接呼叫，但不再自動
路由；`check-coverage` 是 explicit-only legacy alias，位於 frozen family
之外。Capability migration 完成並有 backend-neutral successor 後，才可撤除
MCP grant。
