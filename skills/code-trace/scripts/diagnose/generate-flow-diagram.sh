#!/bin/bash
# generate-flow-diagram.sh (通用版)
# 從函數生成 Mermaid 流程圖

FUNCTION=$1
FILE=$2
OUTPUT=${3:-docs/knowledge/flow-diagram.md}

if [ -z "$FUNCTION" ] || [ -z "$FILE" ]; then
    echo "Usage: $0 <function_name> <file_path> [output_file]"
    echo ""
    echo "建議輸出路徑: docs/knowledge/[feature-name]/diagrams/"
    echo ""
    echo "Examples:"
    echo "  $0 <function_name> <path/to/file.js>"
    echo "  $0 <function_name> <path/to/file.js> docs/knowledge/checkout/diagrams/flow.md"
    echo "  $0 <function_name> <path/to/file.php> docs/knowledge/payment/diagrams/sequence.md"
    exit 1
fi


if [ ! -f "$FILE" ]; then
    echo "❌ 錯誤: 檔案不存在: $FILE"
    exit 1
fi

# 檢查工具
if ! command -v rg &> /dev/null; then
    echo "❌ 錯誤: 需要安裝 ripgrep (rg)"
    echo "請執行: ./check-tools.sh 查看安裝指引"
    exit 1
fi

echo "=== 生成流程圖: $FUNCTION ==="
echo "檔案: $FILE"
echo "輸出: $OUTPUT"
echo ""

# 建立 Mermaid 流程圖
cat > "$OUTPUT" << HEADER
# $FUNCTION 函數流程圖

\`\`\`mermaid
graph TD
    Start["開始: $FUNCTION()"]
HEADER

# 提取函數內的函數呼叫
echo "正在分析函數呼叫..."

# 找出函數的開始和結束行
START_LINE=$(rg -n "function\s+$FUNCTION|$FUNCTION\s*[=:]\s*function" "$FILE" | head -1 | cut -d: -f1)

if [ -z "$START_LINE" ]; then
    echo "❌ 錯誤: 找不到函數 $FUNCTION"
    exit 1
fi

# 提取函數內容並分析呼叫
rg '\w+\(' "$FILE" --line-number --no-heading | \
    awk -v start="$START_LINE" -F: '$1 > start && $1 < start+100 {print $2}' | \
    grep -oP '\w+(?=\()' | \
    sort -u | \
    head -15 | \
    while read -r func; do
        echo "    Start --> ${func}[\"$func()\"]" >> "$OUTPUT"
    done

echo '```' >> "$OUTPUT"

echo "" >> "$OUTPUT"
echo "## 說明" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "此流程圖為自動生成，顯示 \`$FUNCTION()\` 函數中呼叫的其他函數。" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "⚠️ **請注意**：" >> "$OUTPUT"
echo "- 此圖僅顯示函數呼叫關係，不包含邏輯判斷" >> "$OUTPUT"
echo "- 需要手動調整流程以反映實際的執行順序和條件" >> "$OUTPUT"
echo "- 建議結合程式碼閱讀進行修正" >> "$OUTPUT"

echo ""
echo "✅ 流程圖已生成: $OUTPUT"
echo ""
echo "💡 下一步:"
echo "  1. 開啟 $OUTPUT 查看生成的 Mermaid 圖"
echo "  2. 根據實際邏輯調整節點連接"
echo "  3. 加入條件判斷節點 (if/else)"
echo "  4. 加入循環節點 (for/while)"
