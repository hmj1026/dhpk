# Project Pack: Generic

只在需要通用 project pattern，或沒有命中任何專案 pack 時讀取本檔。

## Use This Pack For

- 新專案或未知專案
- 需要 project-agnostic few-shot
- 需要示範如何把 workflow 套到任意 stack，但不能注入既有專案 shortcut

## Generic Guidance

- 先沿用 repo 權威文件與使用者提供的文字、檔案或報告；只確認會影響此任務的語言、版本、架構或 work-item 前置結果
- 不因缺少預填 profile 而建立全套 profile；只要求會改變實作的未知事實
- handoff 與 command template 依已確認的 outcomes 與專案 authority 決策，不依賴既有專案命令別名

## Example 1: New CSV Import Flow

- 情境：Node / Fastify 服務新增 CSV 匯入
- workflow：`Feature Delivery`
- 重點：沿用能說明匯入範圍、欄位 mapping 與驗收的既有計畫；只補未決 mapping 與新行為的 test evidence

## Example 2: Intermittent Billing Bug

- 情境：偶發重複扣款，根因未明
- workflow：`Bug Investigation & Fix`
- 重點：沿用既有症狀與 root-cause report；只追查會改變修復的缺口，再建立 regression evidence

## Example 3: Extract Repeated Constants

- 情境：前端 helper 抽常數，不改行為
- workflow：`Lightweight Maintenance`
- 重點：跳過 heavy artifacts，只保留 targeted verification
