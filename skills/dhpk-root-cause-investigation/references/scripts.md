# Bug Investigation Scripts

此文件整理 `scripts/` 內工具與用法，供需要時查閱。

## 快速開始

1. 進入技能資料夾的 `scripts/` 目錄
2. 執行工具檢查
3. 若腳本無執行權限，設定權限

```bash
cd <skill-root>/scripts
./check-tools.sh
chmod +x *.sh
```

## 工具需求

| 工具 | 用途 | 必要性 |
|------|------|--------|
| `ripgrep` (rg) | 程式碼搜尋 | 必要 |
| `fd` | 檔案搜尋 | 建議 |
| `ast-grep` | AST 層級分析 | 建議 |
| `jq` | JSON 處理 | 可選 |
| `yq` | YAML 處理 | 可選 |

## 腳本清單

### check-tools.sh

功能：檢查所需工具是否已安裝，並提示安裝方式。

用法：
```bash
./check-tools.sh
```

### trace-data-flow.sh

功能：追蹤指定變數的讀寫與參數傳遞。

用法：
```bash
./trace-data-flow.sh <variable_name> [search_path] [file_types]
```

參數：
- `variable_name`：要追蹤的變數名稱（必要）
- `search_path`：搜尋路徑（預設 `.`）
- `file_types`：檔案類型（預設 `php,js,ts,jsx,tsx`）

### search-database-queries.sh

功能：搜尋與指定資料表相關的 SQL 查詢。

用法：
```bash
./search-database-queries.sh <table_name> [search_path]
```

### analyze-function-calls.sh

功能：分析指定檔案中的函數呼叫關係。

用法：
```bash
./analyze-function-calls.sh <file_path> [output_file]
```

建議輸出路徑：
```text
docs/knowledge/[feature-name]/function-analysis.txt
```

### generate-flow-diagram.sh

功能：從指定函數產生 Mermaid 流程圖草稿。

用法：
```bash
./generate-flow-diagram.sh <function_name> <file_path> [output_file]
```

建議輸出路徑：
```text
docs/knowledge/[feature-name]/diagrams/flow.md
```

### find-polluter.sh

功能：逐一執行測試，找出造成檔案/狀態污染的測試檔。

用法：
```bash
./find-polluter.sh <pollution_path> <test_glob> [test_command...]
```

範例：
```bash
./find-polluter.sh .git 'src/**/*.test.ts'
./find-polluter.sh tmp/output.json 'tests/**/*.spec.ts' pnpm test
```

## 常見使用情境

### 追蹤資料不一致

```bash
./trace-data-flow.sh orderStatus
./search-database-queries.sh orders
./analyze-function-calls.sh protected/controllers/OrderController.php docs/knowledge/orders/function-analysis.txt
./generate-flow-diagram.sh processOrder protected/controllers/OrderController.php docs/knowledge/orders/diagrams/flow.md
```

## 工具安裝指引

安裝方式依平台而異，請依 `check-tools.sh` 的提示安裝即可。
