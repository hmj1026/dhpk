#!/usr/bin/env bash
# i18n/zh-TW.sh — 繁體中文
#
# 修改任一行 → 必跑 `bash scripts/check-golden.sh` 確認 generic fixtures
# 仍 PASS（fixture-01-php-yii / fixture-05-generic 等覆蓋 zh-TW 輸出）。

# 標頭欄位 (整行 printf template, 自含 fullwidth `：` 分隔符)
LBL_UPDATE_TIME_LINE="更新時間：%s"
LBL_UPDATE_TAG_LINE="更新標籤：%s %s %s %s"
LBL_UPDATE_PROJECT_LINE="更新專案：%s"
LBL_UPDATE_FILES_PINNED_LINE="更新檔案：（指定 %d 個 commit, 過濾後 %d 個檔案）"
LBL_UPDATE_FILES_RANGE_LINE="更新檔案：（%s...%s 全 diff, 過濾後 %d 個檔案）"
LBL_UPDATE_FILES_ANCHOR_LINE="更新檔案：（anchor grep 命中 %d 個檔案）"

# 主群為空時的說明
LBL_NO_DEPLOY_FILES="（無部署檔案：diff 全屬於文件 / 測試 / harness）"
LBL_NO_DEPLOY_FILES_ANCHOR="（無部署檔案：anchor 字串未命中，或所有命中都被 preset filter 過濾）"

# Warning group header
LBL_OUT_OF_SCOPE_HEADER_TPL="⚠️ 非本次部署範圍（%s...%s 其他累積修改，共 %d 個檔案）"
LBL_OUT_OF_SCOPE_NOTE="   這些檔案不在 --deploy-commits 指定的 commit 內，若非預期請確認後再部署。"

# Section headers
LBL_STATS_HEADER="📊 統計"
LBL_FILTERED_HEADER="🚫 過濾掉（不部署）"
LBL_ROLLBACK_HEADER="🔁 Rollback 提示"

# base==head 自動切換警告
LBL_WARN_BASE_HEAD_SAME_TPL="⚠️  %s 與 HEAD 相同，已自動改用 %s...%s"

# Replay note (寫 stderr)
LBL_NOTE_REPLAY_TPL="NOTE: 以下 commit 已在 %s 範圍內 (歷史 replay 場景, 不影響輸出): %s"
