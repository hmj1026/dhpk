#!/bin/bash
# check-tools.sh
# 檢查 Bug 調查所需的工具是否已安裝

echo "=== Bug Investigation 工具檢查 ==="
echo ""

MISSING_TOOLS=()
INSTALLED_TOOLS=()

# 定義工具列表（以平行索引陣列取代關聯陣列，相容 Bash 3.2+）
TOOL_NAMES=("fd" "rg" "jq" "yq" "ast-grep")
TOOL_DESCS=(
    "檔案搜尋 - 快速模式比對"
    "程式碼搜尋 - 優化的正規表達式搜尋"
    "JSON 資料處理"
    "YAML 資料處理"
    "程式結構分析 - AST 層級搜尋"
)

# 檢查每個工具
for i in "${!TOOL_NAMES[@]}"; do
    tool="${TOOL_NAMES[$i]}"
    desc="${TOOL_DESCS[$i]}"
    if command -v "$tool" &> /dev/null; then
        version=$("$tool" --version 2>&1 | head -1)
        echo "✅ $tool - $desc"
        echo "   版本: $version"
        INSTALLED_TOOLS+=("$tool")
    else
        echo "❌ $tool - $desc"
        MISSING_TOOLS+=("$tool")
    fi
    echo ""
done

# 總結
echo "========================================="
if [ ${#MISSING_TOOLS[@]} -eq 0 ]; then
    echo "✅ 所有工具已安裝！"
else
    echo "⚠️  缺少 ${#MISSING_TOOLS[@]} 個工具"
    echo ""
    echo "📦 安裝指引："
    echo ""

    for tool in "${MISSING_TOOLS[@]}"; do
        case $tool in
            "fd")
                echo "🔧 fd (檔案搜尋):"
                echo "   Windows (Scoop): scoop install fd"
                echo "   Windows (Chocolatey): choco install fd"
                echo "   macOS (Homebrew): brew install fd"
                echo "   Linux (Debian/Ubuntu): apt install fd-find"
                ;;
            "rg")
                echo "🔧 ripgrep (程式碼搜尋):"
                echo "   Windows (Scoop): scoop install ripgrep"
                echo "   Windows (Chocolatey): choco install ripgrep"
                echo "   macOS (Homebrew): brew install ripgrep"
                echo "   Linux (Debian/Ubuntu): apt install ripgrep"
                ;;
            "jq")
                echo "🔧 jq (JSON 處理):"
                echo "   Windows (Scoop): scoop install jq"
                echo "   Windows (Chocolatey): choco install jq"
                echo "   macOS (Homebrew): brew install jq"
                echo "   Linux (Debian/Ubuntu): apt install jq"
                ;;
            "yq")
                echo "🔧 yq (YAML 處理):"
                echo "   Windows (Scoop): scoop install yq"
                echo "   macOS (Homebrew): brew install yq"
                echo "   Linux: wget https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -O /usr/bin/yq && chmod +x /usr/bin/yq"
                ;;
            "ast-grep")
                echo "🔧 ast-grep (程式結構分析):"
                echo "   npm: npm install -g @ast-grep/cli"
                echo "   Cargo: cargo install ast-grep"
                echo "   macOS (Homebrew): brew install ast-grep"
                ;;
        esac
        echo ""
    done

    echo "💡 提示: 您可以選擇手動安裝，或讓 AI 助手協助安裝"
fi

exit ${#MISSING_TOOLS[@]}
