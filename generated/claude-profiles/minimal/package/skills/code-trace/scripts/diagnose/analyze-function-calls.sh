#!/bin/bash
# analyze-function-calls.sh (通用版)
# 使用 ast-grep 分析函數呼叫關係

FILE=$1
OUTPUT=${2:-docs/knowledge/function-analysis.txt}

if [ -z "$FILE" ]; then
    echo "Usage: $0 <file_path> [output_file]"
    echo ""
    echo "建議輸出路徑: docs/knowledge/[feature-name]/"
    echo ""
    echo "Examples:"
    echo "  $0 <path/to/file.js>"
    echo "  $0 <path/to/file.js> docs/knowledge/checkout/function-calls.txt"
    echo "  $0 <path/to/file.php> docs/knowledge/payment/analysis.txt"
    exit 1
fi

if [ ! -f "$FILE" ]; then
    echo "❌ 錯誤: 檔案不存在: $FILE"
    exit 1
fi

echo "=== 分析檔案: $FILE ===" | tee "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# 檢查 ast-grep 是否安裝
if command -v ast-grep &> /dev/null; then
    echo "使用 ast-grep 進行 AST 層級分析..." | tee -a "$OUTPUT"
    echo "" | tee -a "$OUTPUT"

    # 根據檔案類型使用不同的 pattern
    if [[ "$FILE" == *.js || "$FILE" == *.ts ]]; then
        echo "📍 JavaScript/TypeScript 函數定義" | tee -a "$OUTPUT"
        echo "==========================================" | tee -a "$OUTPUT"
        ast-grep --pattern 'function $FUNC($$$) { $$$ }' "$FILE" 2>/dev/null | head -20 | tee -a "$OUTPUT"

    elif [[ "$FILE" == *.php ]]; then
        echo "📍 PHP 函數/方法定義" | tee -a "$OUTPUT"
        echo "==========================================" | tee -a "$OUTPUT"
        ast-grep --pattern 'function $FUNC($$$) { $$$ }' "$FILE" 2>/dev/null | head -20 | tee -a "$OUTPUT"
    fi
else
    echo "⚠️  ast-grep 未安裝，使用 ripgrep 作為替代方案" | tee -a "$OUTPUT"
fi

echo "" | tee -a "$OUTPUT"
echo "📍 使用 ripgrep 分析函數呼叫" | tee -a "$OUTPUT"
echo "==========================================" | tee -a "$OUTPUT"

# 找出函數定義
rg "function\s+\w+|^\s*\w+\s*:\s*function" "$FILE" --no-line-number | \
    head -30 | tee -a "$OUTPUT"

echo "" | tee -a "$OUTPUT"
echo "📍 函數呼叫頻率分析" | tee -a "$OUTPUT"
echo "==========================================" | tee -a "$OUTPUT"

# 分析函數呼叫並計算頻率
rg '\w+\(' "$FILE" --no-line-number --only-matching | \
    grep -v "^//" | \
    sort | uniq -c | sort -rn | \
    head -20 | tee -a "$OUTPUT"

echo "" | tee -a "$OUTPUT"
echo "✅ 分析完成: $OUTPUT"
echo ""
echo "💡 提示:"
echo "  - 安裝 ast-grep 可獲得更精確的 AST 層級分析"
echo "  - 執行 ./check-tools.sh 查看安裝指引"
