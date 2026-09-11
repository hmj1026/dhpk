# Codex Options

只有 caller 明確要求選用 Codex backend 或獨立視角時，才讀取本檔。Adaptive
workflow 的預設 discovery 使用實體化的 `minimal` profile；`full` 與
`compat-v1` 必須明確 opt-in，本檔不會擴大預設 discovery surface。

## Contract

- 預設只走目前的 in-process model 與 dhpk agents；不啟用外部 backend，也不
  自動產生第二意見。
- `--worker=codex` 是明確選取的 Codex CLI mechanical worker，只能用於支援
  該選項的 implementation-class route。
- `--reasoner=codex[:<model>[:<effort>]]` 是明確選取的 Codex CLI read-only
  reasoning pass；它不會改變 primary implementation owner。
- 支援獨立視角的 owner 可用 `--dual` 或其等價的 isolated reviewer dispatch，
  以 fresh、read-only subagent 產生不受 primary 結論影響的第二份證據。
- `--second-opinion=codex-exec` 是明確選取的一次性 blind CLI second opinion。
  它只增加標記清楚的意見，不取代 primary，也不是任何失敗情況下的 silent
  fallback。
- Optional backend 或獨立 reviewer 無法執行時，保留失敗原因並依 owner 的
  degraded/blocked contract 回報；不得改用另一個未被 caller 選取的 transport。

## Phase Mapping

| Phase | Default route | Explicit optional backend or second opinion |
|------|---------------|----------------------------------------------|
| Planning（跨模組 / DDD） | `dhpk-module-design --mode design` | `--mode review\|compare\|adversarial`；需要額外 CLI 視角時使用 `--second-opinion=codex-exec` |
| Planning（根因未知） | `code-trace` | `code-trace --dual` 的 isolated perspective，或明確使用 `--second-opinion=codex-exec`；多重原因才使用 `dhpk-module-design --mode adversarial` |
| Implementation hand-off | `flow-drive`（current model） | `flow-drive --backend cli` 或 `--backend agy`；需要額外 blind 意見時使用 `--second-opinion=codex-exec` |
| Test gate | `dhpk-tdd-workflow` + `change-verdict` | 依 owner 支援度選 isolated reviewer；或明確使用 `--second-opinion=codex-exec` |
| Review gate | `change-verdict`（current model） | `change-verdict --backend cli`；額外意見使用 owner 支援的 `--second-opinion=codex-exec` |
| Security gate | `change-verdict`（isolated read-only current-model audit） | 僅在明確要求且 owner 支援時使用 isolated reviewer 或 `--second-opinion=codex-exec` |

Phase mapping 只指定 route，不會替 caller 選擇 optional backend。`dhpk-module-design`、
`flow-drive` 與 `change-verdict` 是本 workflow 的明確 owner；需要
second opinion 時，沿用 owner 的 option 並在輸出中標記 primary 與獨立意見的
差異。

## Selection and degradation

1. 先執行 default route，並記錄 scope、assumptions 與 primary evidence。
2. 只有 caller 指定 `--worker=codex`、`--reasoner=codex`、isolated reviewer
   或 `--second-opinion=codex-exec` 時，才 dispatch 對應的附加路徑。
3. Second opinion 必須收到自足 context，不能讀取 primary 結論後再假裝 blind。
4. 沒有第二視角時，凡 owner 要求獨立驗證的結果都標記
   `degraded: primary model only`，並明說沒有 independent review；不可把
   primary 結果描述成 independently verified。
5. Optional path 失敗時只回報該 path 的 unavailable/blocked 狀態；不得隱式
   降級到另一個 backend 或重新解讀 caller 的其他選項。

## Downstream hand-off

Next Command 應保留 caller 已明確選取的 backend 或 second-opinion option；若
沒有選取，就不要附加任何 Codex option，讓下游 owner 使用 current-model
default。實作、架構與 review hand-off 分別指向
`flow-drive`、`dhpk-module-design` 與 `change-verdict`，不透過舊的
alias 或隱藏 route。
