#!/bin/bash
# trace-data-flow.sh (通用版)
# 追蹤指定變數的資料流 - 使用 ripgrep 進行高效搜尋

VARIABLE=$1
SEARCH_PATH=${2:-.}
FILE_TYPES=${3:-"php,js,ts,jsx,tsx"}

if [ -z "$VARIABLE" ]; then
    echo "Usage: $0 <variable_name> [search_path] [file_types]"
    echo ""
    echo "Arguments:"
    echo "  variable_name  - 要追蹤的變數名稱"
    echo "  search_path    - 搜尋路徑 (預設: 當前目錄)"
    echo "  file_types     - 檔案類型 (預設: php,js,ts,jsx,tsx)"
    echo ""
    echo "Examples:"
    echo "  $0 <variable_name>"
    echo "  $0 <variable_name> <path/to/directory>"
    echo "  $0 <variable_name> . php"
    exit 1
fi

# 檢查 ripgrep 是否安裝
if ! command -v rg &> /dev/null; then
    echo "❌ 錯誤: 需要安裝 ripgrep (rg)"
    echo "請執行: ./check-tools.sh 查看安裝指引"
    exit 1
fi

echo "=== 追蹤變數: $VARIABLE ==="
echo "搜尋路徑: $SEARCH_PATH"
echo "檔案類型: $FILE_TYPES"
echo ""

# 建立檔案類型參數
IFS=',' read -ra TYPES <<< "$FILE_TYPES"
TYPE_ARGS=""
for type in "${TYPES[@]}"; do
    TYPE_ARGS="$TYPE_ARGS --type $type"
done

echo "📍 1. 變數賦值位置 (寫入)"
echo "========================================="
rg "$VARIABLE\s*=" "$SEARCH_PATH" \
    $TYPE_ARGS \
    --heading --line-number --context 2 \
    --max-count 20

echo ""
echo "📍 2. 變數讀取位置 (讀取)"
echo "========================================="
rg "(\\\$|this\.|self\.|POS\.)?$VARIABLE(?!\s*=)" "$SEARCH_PATH" \
    $TYPE_ARGS \
    --heading --line-number \
    --max-count 15

echo ""
echo "📍 3. 函數參數 (資料傳遞)"
echo "========================================="
rg "function.*$VARIABLE|\($VARIABLE\s*[,)]" "$SEARCH_PATH" \
    $TYPE_ARGS \
    --heading --line-number \
    --max-count 15

echo ""
echo "✅ 追蹤完成"
echo ""
echo "💡 提示:"
echo "  - 使用 rg -A5 -B5 查看更多上下文"
echo "  - 使用 rg --stats 查看統計資訊"
echo "  - 使用 rg -l 只顯示檔案名稱"
