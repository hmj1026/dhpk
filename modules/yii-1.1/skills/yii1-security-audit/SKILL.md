---
name: yii1-security-audit
description: 'Yii 1.1（PHP 5.6）框架安全白盒靜態審計。Use when：對 Yii 1.1 專案查找漏洞、驗證 accessRules/checkAccess/CSRF/SQL injection/CUploadedFile/Session 設定，或框架安全複查（即使用戶只說「檢查這個 Controller 有沒有安全問題」也應觸發）。Not for：Yii2 專案、非 PHP 專案、純業務邏輯演算法審查。Output：依 AUTH/CSRF/XSS/SQL/CFG/LOGIC/FILE 分類、含檔名:行號 + 可觀測 PoC + Yii API 修復建議的審計報告。'
allowed-tools: 'Read, Grep, Glob, Bash(find *), Bash(grep *), Bash(ls *)'
---

# Yii 1.1 框架安全審計（yii1-security-audit）

分析 Yii 1.1 專案的框架機制與配置踩坑，重點覆蓋：
- 訪問控制：`filters()` / `accessRules()` / `CAccessControlFilter` 規則與覆蓋範圍
- RBAC：`Yii::app()->user->checkAccess()` / `getLevel()` 鑑權完整性與物件歸屬
- CSRF：`protected/config/main.php` 的 `request` 元件設定
- 輸出編碼：views 是否使用 `CHtml::encode()`；危險原樣輸出
- SQL 注入：`createCommand("....$var")` 字串拼接；`CDbCriteria` 未綁定參數
- Mass Assignment：`$model->attributes = $_POST[...]` 配合 `rules()` / scenario 安全邊界
- 上傳安全：`CUploadedFile` 的副檔名白名單、MIME 檢查、儲存位置
- Session 安全：`cookieParams` httponly / secure 設定

## When NOT to Use

- Yii2 專案（類別前綴 `yii\`、`composer.json` 含 `yiisoft/yii2`、有 `web/index.php`）— 本技能僅針對 Yii 1.1。
- 非 PHP 或非 Yii 框架的專案。
- 純業務邏輯 / 演算法正確性審查（非框架安全機制）。
- 需要動態執行 exploit 的滲透測試 — 本技能只做白盒靜態審計，PoC 僅輸出可觀測框架而非可直接執行的 payload。

## 輸入

用戶提供：
- `source_path`：Yii 1.1 專案根目錄
可選：
- `output_path`：輸出目錄（預設 `{source_path}_audit`）

## Output（輸出目錄與報告格式）

```
{output_path}/framework_audit/
  yii1_{timestamp}.md
```

報告須逐項輸出 AccessControl / RBAC / CSRF / XSS / SQL / MassAssignment / File / Session 結果，每條發現含：通用類型碼 + 位置（檔名:行號）+ 可觀測 PoC 框架 + 對應 Yii 1.1 API 的修復建議。

## 框架識別（必做）

必須給出 Yii 1.1 識別證據點（不允許空口斷言）：

| 證據類型 | 查找目標 |
|---------|---------|
| 入口腳本 | `protected/yiic.php` 或根目錄 `index.php` 含 `Yii::createWebApplication` |
| 保護目錄 | `protected/controllers/`、`protected/models/`、`protected/views/` 均存在 |
| 框架類別 | 繼承 `CController`、`CActiveRecord`、`CFormModel` |
| 設定檔 | `protected/config/main.php` 包含 `components` 陣列 |
| 非 Yii2 確認 | 沒有 `composer.json` 的 `yiisoft/yii2`、沒有 `web/index.php` |

**若無法找到以上至少 3 項證據，停止審計並說明原因。**

## 風險類型映射（必做）

每條發現都必須寫明：
- 通用類型碼：`AUTH` / `CSRF` / `XSS` / `SQL` / `CFG` / `LOGIC` / `FILE`
- 映射原因（一句話）

## 必審清單（必做：逐項檢查並輸出結果）

### 1) AccessControl 鑑權規則正確性（AUTH）

**搜尋目標：**
- `protected/components/Controller.php` 的 `filters()` / `filterCheckPermission()` / `filterAccessControl()`
- 各 Controller 的 `filters()` 與 `accessRules()` 是否存在及覆蓋哪些 actions
- `protected/config/main.php` 的全域 filter 設定

**判定規則：**
- 若某 Controller 完全無 `filters()` 也無 `accessRules()`，且繼承鏈中無全域 filter → 輸出 AUTH 風險
- 若 `accessRules()` 中有 `'actions'=>array(...)` 但遺漏已知危險 action → 輸出 AUTH 風險
- 若直接使用 `getLevel() <= N` 等自訂鑑權但無統一 filter → 輸出 LOGIC 風險

**<your-project> 模式提示：**
基底 `Controller::filterCheckPermission()` 透過 `zdn_menu` 資料表動態查詢權限碼；
子 Controller 必須在 `filters()` 中明確宣告 `'checkPermission'` 才能觸發。

### 2) RBAC / 權限校驗完整性（AUTH/LOGIC）

**搜尋目標：**
- `Yii::app()->user->checkAccess('role')`、`->getLevel()`
- 控制器 / 服務層對物件歸屬的校驗：是否同時驗證 `owner_id` / `user_id` / `store_no`
- `hasPermission()` 在 <your-project> 中是專屬非標準方法，需確認其實作邏輯

**判定規則：**
- 若只判斷「用戶有某權限」，但未校驗被操作資源的歸屬 → 輸出 LOGIC 風險（IDOR 型別）
- 若 `getLevel() <= N` 是唯一鑑權依據且未與資源歸屬結合 → 輸出 AUTH 風險

### 3) CSRF（CSRF）

**搜尋目標：**
- `protected/config/main.php`（或各環境設定檔）的 `'request'` 元件：
  - `enableCsrfValidation`（Yii 1.1 預設 `false`）
  - `enableCookieValidation`
- view 中的 `CActiveForm::beginWidget()` 是否存在
- 直接接收 `$_POST` 的 action 是否有任何 token 校驗

**判定規則：**
- `enableCsrfValidation` 未設為 `true` → 輸出 CFG 風險（全站 CSRF 防護缺失）
- 有狀態變更 POST 但未走 `CActiveForm` 也無手動 CSRF 檢查 → 輸出 CSRF 風險

### 4) 輸出編碼與 XSS（XSS）

**搜尋目標：**
- `protected/views/` 中直接 `echo $model->xxx` 或 `echo $data['xxx']` 而不包裹 `CHtml::encode()`
- JS 區塊中直接嵌入 PHP 變數（如 `var x = '<?php echo $val ?>'`）
- 使用 `print_r` / `var_dump` 輸出原始資料到頁面

**判定規則：**
- 找到未 encode 的用戶可控資料輸出 → 輸出 XSS 風險（含位置與 data flow）
- `CHtml::encode()` 是 Yii 1.1 標準；JS 中需用 `CJSON::encode()`

### 5) SQL 注入（SQL）

**搜尋目標（優先順序）：**
1. `createCommand("... $var ...")` — 字串插值直接進 SQL
2. `createCommand("..." . $var . "...")` — 字串拼接進 SQL
3. `$criteria->condition = "col = '$var'"` — criteria 未用 `:param` 綁定
4. `$criteria->addCondition("col = '$var'")` — 同上
5. 動態 ORDER BY/欄位名未做白名單驗證

**判定規則：**
- 找到直接拼接且來源可追溯到 `$_GET` / `$_POST` / `Yii::app()->request` → 輸出 SQL 高風險
- 找到直接拼接但來源是內部常數或已驗證枚舉 → 輸出 SQL 中風險（需說明緩解條件）
- 使用 `:param` 綁定或 `bindParam()`/`bindValue()` 的 `createCommand` 為安全模式，不輸出風險

**重要 API 辨認（來源：Context7 yii_framework 原始碼）：**
- 安全：`->queryAll(true, array(':id' => $id))`（params 是第二個引數，非第一個）
- `queryRow()` 無結果時回傳 `false`，需用 `!$result` 而非 `=== null` 判斷
- `$criteria->compare('col', $val)` 內部自動綁定，為安全模式

### 6) Mass Assignment（LOGIC）

**搜尋目標：**
- `$model->attributes = $_POST['ModelName']` 或 `getPost(...)`
- 對應模型的 `rules()` 中 `safe` 規則或 scenario 設定
- 是否有敏感欄位（`role`、`is_admin`、`store_no`、`level`）未被 `unsafe` 標記

**判定規則：**
- `rules()` 中宣告 `array('*', 'safe')` 或大量敏感欄位在 safe scenario → 輸出 LOGIC 高風險
- scenario 未正確設定就進行 mass assignment → 輸出 LOGIC 風險

### 7) 文件上傳安全（FILE）

**搜尋目標：**
- `CUploadedFile::getInstance()` / `getInstanceByName()`
- 是否檢查：(a) 副檔名白名單、(b) MIME type、(c) 儲存位置是否在 webroot 內

**判定規則：**
- 無副檔名白名單 → 輸出 FILE 高風險
- 儲存到 webroot 可直接存取路徑且無執行限制 → 輸出 FILE 高風險
- 只靠 `getType()`（即 `$_FILES['type']`，可偽造）做 MIME 檢查 → 輸出 FILE 中風險
- 正確方式：`CFileHelper::getMimeType($file->getTempName())` 做伺服器端 MIME 驗證

### 8) Session 與 Cookie 安全（CFG）

**搜尋目標：**
- `protected/config/main.php` 的 `'session'` 元件 `cookieParams` 與 `cookieMode`

**判定規則：**
- `httponly` 未設為 `true` → 輸出 CFG 風險（XSS 可竊取 session）
- `secure` 在 HTTPS 環境下未設為 `true` → 輸出 CFG 風險
- `cookieMode` 未設為 `'only'`（允許 URL session ID）→ 輸出 CFG 中風險

## 可觀測 PoC（必做）

至少給出以下兩類之一並寫清觀察點：

**AUTH PoC：**
對疑似無 filter 的 Controller action，以未登入或低權限用戶直接 GET/POST。
輸出：`GET /index.php?r=controller/action` + 預期 vs 實際狀態碼

**SQL PoC：**
對有字串拼接的查詢，在對應參數插入 `' OR '1'='1`。
輸出：注入位置（controller/action + 參數名）+ payload + 觀察點

**CSRF PoC：**
對狀態變更 POST endpoint，構造無 CSRF token 的跨站表單。
輸出：請求路徑 + 預期（拒絕）vs 實際結果

PoC 輸出要求：
- 必須包含 controller/action 路由與參數欄位
- 必須說明預期 HTTP 狀態碼與業務結果
- 不輸出可直接執行的惡意 payload；輸出觀察框架即可

## 參考資料

詳細安全 vs 不安全模式的代碼對照表：`references/yii1-security-patterns.md`

包含：accessRules 範例、CSRF main.php 設定、CHtml encode 對照、createCommand 綁定、CDbCriteria 綁定、Mass Assignment scenario、CUploadedFile 上傳白名單、Session cookieParams。

## Verification（輸出完整性檢查，強制）

- [ ] 包含 Yii 1.1 框架識別證據（至少 3 項）
- [ ] 逐項輸出：AccessControl / RBAC / CSRF / XSS / SQL / MassAssignment / File / Session 結果
- [ ] 每條風險都有：類型碼 + 位置（檔名:行號）+ 可觀測驗證框架 + 修復建議
- [ ] SQL 注入已區分「直接拼接」vs「CDbCriteria 未綁定」vs「安全綁定」
- [ ] 每條修復建議對應到 Yii 1.1 具體 API（不是泛用說法）
- [ ] `queryRow()` 回傳值判斷使用 `!$result` 而非 `=== null`
