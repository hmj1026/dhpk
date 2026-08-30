# Release 流程

> **語言**：[English](./RELEASE.md) · **繁體中文**

本文件是 dhpk maintainer 的繁中 release 契約。欄位、script 參數與 failure handling
以 [英文版本](./RELEASE.md) 為工程 SSOT；本頁完整覆蓋分支、changelog、package、
consumer gate、發布與 rollback 流程。

## 契約用語

- **Supported**：Claude marketplace 與 `install-codex-skills.sh` project sync。
- **Development-only**：`claude --plugin-dir`，不可當作發布驗證。
- **Experimental**：Codex native marketplace；通過 gate 不會自動 graduation。
- **Experimental**：AGY native plugin；package/discovery 證據與 runtime 支援分開判定。

Release evidence 必須來自 immutable version/tag、CI run、GitHub Release 與實際
consumer gate；working tree 或本機 live reload 只能作為開發證據。

## 分支規則

1. 直接在最新、乾淨的 `develop` 準備 release；preparation script 會拒絕其他分支。
2. 從準備完成的 `develop` 建立以 `main` 為 base 的 release PR。
3. 不直接在 `main` 開發，也不在 tag 後修改已發布 artifact。
4. PR 合併到 `main` 後建立 tag。Release 成功後，CI 先確認 `develop` 沒有在
   release PR 後前進，再確認 tree 與 `main` 相同，最後以
   `--force-with-lease` 把 `develop` 對齊到 `main`；任一步失敗都保留兩個 ref，
   交由 recovery PR 處理。

Release PR 必須使用 GitHub 的 **Create a merge commit** 合併方式；不可使用
squash merge 或 rebase。Generated package provenance 必須保留 release candidate
commit 的 ancestry；publish runner 會確認 GitHub `mergeCommit.oid` 等於抓下來的
`main` HEAD、該 commit 有兩個 parent，並在建立 immutable tag 前重新執行 PACKAGE gate。

## Release-note fragments

一般 feature/fix PR 在 `changelog.d/` 加入 fragment：

```text
scope: <area>
note: <user-visible change>
```

使用 `node scripts/ci/validate-changelog-fragments.js --diff-base develop`
驗證。Release preparation 會把 fragment 編入 `CHANGELOG.md`；不可手動遺漏或重複。

## 準備 release candidate

在乾淨的 `develop` 上執行 preparation script。它會更新所有版本 SSOT、產生
changelog，並從 `manifests/distribution-inventory.json` 重新 materialize
`plugins/dhpk/` native package：

```bash
node scripts/release/prepare-release.js write \
  --version <X.Y.Z> --date YYYY-MM-DD --summary "One-line release summary"
```

版本必須在下列位置一致：

- `.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`
- `plugins/dhpk/.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`
- `plugins/dhpk/provenance.json`

Write mode 除版本 manifest 與 `CHANGELOG.md` 外，也會重新產生完整
`plugins/dhpk/`（manifest、18 個 physical 項目、fingerprints、provenance）。
Canonical skill 只能修改 `skills/dhpk-*/`。Module/Codex projection 是 symlink，
native package 是 generated physical artifact，不可各自手改。

## 必跑驗證

```bash
node scripts/ci/validate-plugin.js
node scripts/ci/catalog.js --check all
bash scripts/validate/validate-harness.sh
node scripts/ci/validate-distribution.js
node scripts/ci/validate-openai-metadata.js
bin/dhpk distribution codex-native verify --json
node scripts/ci/validate-references.js
node scripts/ci/validate-changelog-fragments.js --diff-base develop
node tests/run-all.js
```

Skill platform 的預期 topology：100 個 canonical package、62 個 Agent Plugin
skill、31 modules、18 個 Codex project/native 項目（16 個可呼叫 skill 加上內部
transport 與 dispatch-context runtime）；另有五筆不進入 discovery 的
`retired_skills` ledger row。Module/Codex project projection 使用相對 symlink，
native package 零 symlink。

Release gate 分三層：

1. **SOURCE**：inventory、canonical source、metadata 與版本一致。
2. **PACKAGE**：tracked `plugins/dhpk/` layout、fingerprint、provenance、deterministic drift。
3. **CONSUMER**：用真實 Codex CLI 安裝 exact tracked artifact，刪除 source checkout，
   再確認 installed cache 仍包含全部 physical skill。

若環境沒有 Codex CLI，CONSUMER gate 必須回報 `UNAVAILABLE`，不能假裝 `PASS`；這
不會讓 supported Claude/project-sync gate 失敗，但 release evidence 必須保留狀態。

## Review 與發布

1. 對 release diff 執行 code、doc、security 與 release parity review。
2. 確認 generated artifact 與 source 同一個 commit，worktree clean。
3. Push `develop`，建立以 `main` 為 base 的 release PR。
4. 在人工 merge gate 選擇 **Create a merge commit**；不可 squash/rebase。
5. 合併 PR 後由 runner 自動執行 `node scripts/release/publish-gate.js --version X.Y.Z`，
   確認 SOURCE 與 PACKAGE 都 PASS；可先手動執行作為診斷，但不能取代 runner。
6. runner 會再確認 merged PR SHA、`main` HEAD 與雙親 merge topology，並在合併後
   的 `main` 驗證 SOURCE + PACKAGE（包含 provenance）；通過後才建立 annotated semver tag。
7. Push tag，等待 release workflow 與 GitHub Release 完成。
8. 驗證 marketplace metadata、下載內容與 tag SHA 一致。
9. Release 成功後，先確認 `origin/develop` 仍等於 merged release PR head，再確認
   tree 與 `origin/main` 相同，最後由 `sync-develop` 使用
   `--force-with-lease` 將 develop ref 對齊 main。任一步失敗都保留兩個 ref，
   不可 force-push；recovery 見英文 [RELEASE.md](./RELEASE.md)。

不得在 CI 尚未完成時把 release 宣告為成功，也不得把本機生成結果當作 published
consumer proof。

## 完成與 recovery

發布完成必須記錄：

- Version 與 tag。
- Tag/merge commit SHA。
- CI run 與 GitHub Release URL。
- Claude supported gate 結果。
- Codex project-sync gate 結果。
- Codex native CONSUMER gate 的 PASS/UNAVAILABLE 狀態。
- develop idle-align 結果與 expected release PR head SHA。

若已發布版本有問題，不修改 tag 內容。建立新的 patch/hotfix release。Consumer
rollback 代表重新安裝先前 known-good immutable version，並啟動新 session。

## Consumer update boundary

發布不會自動更新已安裝 consumer：

- Claude consumer 執行 `claude plugin update dhpk@dhpk`，必要時依 version pin
  uninstall/reinstall，然後啟動新 session。
- Codex project consumer 在 Claude update 後執行
  `install-codex-skills.sh --update`；跨整併版本第一次使用 `--migrate --update`。
- Codex marketplace 仍為 Experimental。
- `claude --plugin-dir` 仍為 Development-only。

完整 skill 名稱、receipt 與 rollback 說明見
[`docs/skill-platform-migration.zh-TW.md`](./docs/skill-platform-migration.zh-TW.md)。

## 非目標

此契約不自動 merge PR、不自動更新 consumer、不新增 distribution surface，也不承諾
adapter platform 的 native parity。
