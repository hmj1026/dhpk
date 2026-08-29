# plugins/dhpk — Codex Native Marketplace 發布 package

> **語言**：[English](./README.md) · **繁體中文**

這個目錄是 `.agents/plugins/marketplace.json` 指向的 plugin folder。Codex 不會發現
`source.path` 直接指向 marketplace root (`./`) 的 local plugin，因此 marketplace
entry 必須指向具體 plugin subdirectory。

本目錄是保留的 Experimental legacy/native surface；standard Agent Plugin 與
Cursor 路徑請見[平台安裝 SSOT](../../docs/platform-installation.zh-TW.md)。

## 追蹤中的實體發布 artifact

此目錄的 `skills/`、`fingerprints.json` 與 `provenance.json` 是**產生後納入版控的
發布 artifact**，不是手寫內容，也不是 symlink mirror。它由
`manifests/distribution-inventory.json` 明確的 `codex-native` surface 與 root
canonical package deterministic 產生：

```bash
node scripts/ci/gen-codex-native-package.js plugins/dhpk --version=X.Y.Z
```

`skills/` 下每個檔案都是實體檔，零 symlink；即使刪除產生它的 source checkout，
乾淨 marketplace cache install 仍能運作。Root `.codex-plugin/plugin.json` 與此
folder 的 wrapper manifest 都解析到同一份 physical tree，不會維護第二份 copy。

| 檔案 | 用途 |
|---|---|
| `skills/<dhpk-name>/` | 每個 `codex-native` skill 的實體內容，以 public name 為 key。 |
| `fingerprints.json` | Per-skill content hash，用於 deterministic drift check。 |
| `provenance.json` | Source version/commit、inventory digest、generator version、selected stable id 與 public name。 |

重新產生與提交此目錄是 release PR 的一部分。CI 會執行
`verify-codex-native-package.js` 驗證，但不會自動 commit。Claude/Codex manifest、
provenance 與 marketplace 版本必須一致，並由 release-parity tests 強制。

## 目前 Codex plugin-mode 狀態

```bash
codex plugin marketplace add hmj1026/dhpk
codex plugin add dhpk@dhpk
```

真實 consumer gate 會在 sandboxed `CODEX_HOME` 安裝這份 tracked artifact、刪除
source checkout，再確認 16 個可呼叫 native skill 與內部 transport、dispatch-context runtime 都是可發現的實體檔。

這仍是 **experimental** support tier。結構與 consumer proof 通過，是未來 graduation
決策的必要證據，但不會自動升級支援等級。正式支援的 Codex 路徑仍是 project-local
sync：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

完整 surface、gate 與安全模型見
[`../../docs/distribution-surfaces.zh-TW.md`](../../docs/distribution-surfaces.zh-TW.md)。
