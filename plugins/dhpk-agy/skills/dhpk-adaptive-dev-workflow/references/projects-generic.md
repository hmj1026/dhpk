# Project Pack: Generic

只在需要通用 project pattern，或沒有命中任何專案 pack 時讀取本檔。

## Use This Pack For

- 新專案或未知專案
- 需要 project-agnostic few-shot
- 需要示範如何把 workflow 套到任意 stack，但不能注入既有專案 shortcut

## Generic Guidance

- 先從 repo 權威文件推導語言、版本、架構與 work-item system
- 若 repo 沒有明確預填值，就把 profile 視為需要完整補齊
- handoff 與 command template 依通用 workflow 決策，不依賴既有專案命令別名

## Example 1: New CSV Import Flow

- 情境：Node / Fastify 服務新增 CSV 匯入
- workflow：`Feature Delivery`
- 重點：補 profile、work-item、legacy-reference、RED，再進入實作

## Example 2: Intermittent Billing Bug

- 情境：偶發重複扣款，根因未明
- workflow：`Bug Investigation & Fix`
- 重點：先證據與 regression path；缺 profile 不單獨擋住流程

## Example 3: Extract Repeated Constants

- 情境：前端 helper 抽常數，不改行為
- workflow：`Lightweight Maintenance`
- 重點：跳過 heavy artifacts，只保留 targeted verification
