#!/bin/bash
# search-database-queries.sh
# 搜尋程式碼中的資料庫查詢 - 找出與特定表相關的 SQL

TABLE_NAME=$1
SEARCH_PATH=${2:-.}

if [ -z "$TABLE_NAME" ]; then
    echo "Usage: $0 <table_name> [search_path]"
    echo ""
    echo "Examples:"
    echo "  $0 <table_name>"
    echo "  $0 <table_name> <path/to/directory>"
    exit 1
fi

# 檢查工具
if ! command -v rg &> /dev/null; then
    echo "❌ 錯誤: 需要安裝 ripgrep (rg)"
    echo "請執行: ./check-tools.sh 查看安裝指引"
    exit 1
fi

echo "=== 搜尋資料表: $TABLE_NAME ==="
echo "搜尋路徑: $SEARCH_PATH"
echo ""

echo "📍 1. SELECT 查詢"
echo "========================================="
rg "SELECT.*FROM\s+['\`]?${TABLE_NAME}['\`]?" "$SEARCH_PATH" \
    --type php --type js \
    --heading --line-number --context 1 \
    --max-count 10

echo ""
echo "📍 2. INSERT 操作"
echo "========================================="
rg "INSERT\s+INTO\s+['\`]?${TABLE_NAME}['\`]?" "$SEARCH_PATH" \
    --type php --type js \
    --heading --line-number --context 1 \
    --max-count 10

echo ""
echo "📍 3. UPDATE 操作"
echo "========================================="
rg "UPDATE\s+['\`]?${TABLE_NAME}['\`]?\s+SET" "$SEARCH_PATH" \
    --type php --type js \
    --heading --line-number --context 1 \
    --max-count 10

echo ""
echo "📍 4. DELETE 操作"
echo "========================================="
rg "DELETE\s+FROM\s+['\`]?${TABLE_NAME}['\`]?" "$SEARCH_PATH" \
    --type php --type js \
    --heading --line-number --context 1 \
    --max-count 10

echo ""
echo "✅ 搜尋完成"
