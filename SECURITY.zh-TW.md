# 安全政策

> **語言**：[English](./SECURITY.md) · **繁體中文**

## 支援版本

只有最新的 minor 版本線會收到安全修補。較舊的版本線不會回補；請升級到最新版本取得修補。

| 版本 | 安全修補 |
|---|---|
| 最新 minor（見 [tags](https://github.com/hmj1026/dhpk/tags)） | 是 |
| 較舊的 minor | 否 |

## 回報漏洞

請透過 GitHub private vulnerability reporting 私下回報：開啟 repository 的 **Security** 分頁，選擇 **Report a vulnerability**，或直接前往 <https://github.com/hmj1026/dhpk/security/advisories/new>。

疑似漏洞請不要開公開的 issue、pull request 或 discussion。

請盡量提供：

- 受影響的版本或 commit，以及 Host（Claude Code、Codex 或 Cursor）
- 受影響的元件（例如某個 hook、installer 或生成檔案）
- 重現步驟或 proof of concept
- 已觀察到或預期的影響

## 回應時程

- 收到回報後 7 天內首次回覆。
- 目標在 90 天內發布修補版本（best effort）。較複雜的問題可能需要更久，進度會在私下 advisory 中告知。
- 揭露時間與回報者協調；修補版本發布後才公開 advisory。

## 範圍

範圍內：

- hooks，以及它們在使用者機器上執行的腳本
- installer、sync 與 update 腳本
- 提交在本 repository 的生成產物
- 由本 repository 建置並發布的 plugin 套件

範圍外：

- dhpk 審查或編輯的、使用者自己專案中的程式碼
- dhpk 整合的第三方工具或服務本身的漏洞（例如 Claude Code、Codex、Cursor、OpenSpec 或 MCP server）；請回報給各自的維護者
- 必須先由攻擊者控制使用者機器或 repository 設定才能成立的問題
