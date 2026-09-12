# GitHub Issues 2026-07-28 修正方案

## 方案選項

| 方案 | 描述 | 優點 | 風險/缺點 | 影響範圍 | 測試需求 |
|---|---|---|---|---|---|
| A | 以三個 OpenSpec changes 分別修正 goal/reviewer fallback、CLI timeout recovery、Codex native publication。 | 每個 change 有單一責任、可獨立審核與回滾；保留 issue 對應關係。 | 需要三次實作與 review gate。 | harness policy、worker contracts、Codex release surface。 | 現有回歸測試加每個 change 的新 contract tests。 |
| B | 將全部四個未解 issue 合成一個大型 governance change。 | 一次規劃、較少 artifact。 | goal/reviewer、CLI worker、Codex packaging 的風險與 owner 不同，review 難以聚焦。 | 跨越所有發佈與執行面。 | 大型整合測試，失敗定位成本高。 |
| C | 只修改文件，暫不建立可 apply 的 tasks。 | 最小短期成本。 | 無法把 #88 的實際 publication gate 或 #107 的 recovery state 變成可驗證 contract。 | 文件面為主。 | 靜態 grep，無法證明 consumer/runtime 行為。 |

## 判斷依據

- #106 與 #108 的 owner 都在 `/goal` policy／review fallback，合併可共享同一個 fallback contract 與 generated-goal test surface。
- #107 的故障邊界是外部 CLI partial execution，必須單獨定義 completion ledger、retry scope 與 stop state，不能與一般 reviewer policy 混寫。
- #88 的 staged generator 已通過 physical-file 與 deterministic tests，但正式 manifest 尚未切換；這是 release/package ownership 問題，需獨立決策 retention 與 consumer gate。
- #106 當前 cache 存在使 live reproduction 被遮蔽，因此只把「靜態 fallback 缺失」列為 confirmed defect，將無 cache runtime proof 列為實作驗證項，不過度宣稱目前環境已重現。

## 推薦方案

採用方案 A，建立以下三個 OpenSpec changes：

1. `harden-opsx-goal-policy-fallbacks`
2. `harden-cli-worker-mid-batch-timeout`
3. `make-codex-plugin-distribution-install-safe`

先由人工審核三份 proposal/design/spec/tasks；核准後按 change 分別以 TDD／contract tests 實作，並在 #88 最後補上實際 package／consumer cache proof。

## 後續行動

- [x] 建立三個 spec-driven OpenSpec change。
- [x] 將目前證據與已知限制寫入調查文件。
- [ ] 人工審核三個 change 的 requirements、release artifact retention policy 與 timeout retry semantics。
- [ ] 核准後才實作；實作完成後重新驗證 GitHub issue，只有 acceptance criteria 全部通過才關閉 #106、#107、#108、#88。
