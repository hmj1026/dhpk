# dhpk AGY SubAgent 安裝與驗證

本指南說明 AGY package 的產物、安裝與驗證邊界。平台路徑與支援狀態以
[平台安裝指南](platform-installation.zh-TW.md) 和
[distribution inventory](../manifests/distribution-inventory.json) 為準。
歷史診斷、版本觀察與載入數量保留在本機 `docs/evidence/`。

## Agent 適配契約

Canonical agents 由 generator 投影為 AGY package。
[AGY adapter](../scripts/agy-adapt-agents.js) 擁有 tools/model 轉譯與
Frontmatter allowlist；不要在指南維護另一份模型或工具對照表。
不支援的工具或模型必須由 adapter 明確拒絕，不能用猜測的別名代替。

Adapter 只能操作 owner-controlled staging package。該 root 必須具備
`plugin.json`、`provenance.json`、`fingerprints.json` 與 `agents/`。
Consumer installation 及其子目錄都不是合法的 adapter target。

## 建立、驗證與安裝

先建立並驗證同一份 staging package：

```bash
bin/dhpk distribution agy-plugin generate \
  --output /tmp/dhpk-agy-staging \
  --version=<version> --json
bin/dhpk distribution agy-plugin validate \
  --output /tmp/dhpk-agy-staging --json
```

若需要單獨重跑 transform，使用上述 owner-controlled staging root：

```bash
node scripts/agy-adapt-agents.js --staging-root /tmp/dhpk-agy-staging
```

安裝使用已驗證的同一份 staging package，保留 provenance、collision 與
rollback ownership：

```bash
node scripts/ci/install-agy-plugin.js install \
  --source /tmp/dhpk-agy-staging --json
```

Canonical target 為 `~/.gemini/antigravity-cli/plugins/dhpk/`。
Legacy candidate `~/.gemini/config/plugins/dhpk/` 僅供唯讀診斷及明確 migration。
`plan`／`status` 偵測既有 receipt，不修改 installation。
搬移前先確認只有一個 receipt-owned legacy target：

```bash
node scripts/ci/install-agy-plugin.js migrate \
  --source /tmp/dhpk-agy-staging --json
```

## Discovery 與 runtime 驗證

```bash
agy agents
agy plugins list
```

`agy plugins list` 只確認 import record。Native discovery 必須使用隔離 HOME
取得 `agy agents` 證據，並與此次 package 的 agent inventory 比對。
載入數量不能代表 runtime PASS；仍須取得實際派發與完成結果。

認證、網路或 CLI loader 無法提供 runtime 證據時，保留
`UNAVAILABLE`／`SKIP_INCOMPATIBLE` 或未執行狀態。
Structural validation、discovery 和 runtime 結果分別記錄。
實際派發 payload 以受測 AGY CLI 的工具契約為準。
