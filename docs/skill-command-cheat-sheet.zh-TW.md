# dhpk 技能與 Slash Command 快速速查（新手友善版）

這份表是「你要打字時可直接對照」版本。

先分兩種：

- **模型可先挑用（預設可自動使用）**：有這類需求時，模型可以先自動選技能。你照需求描述就好。
- **你要手動直接叫用**：不會自動被模型插入，必須你在訊息中明確下指令。

如果你不熟悉參數符號：

- `<>` = 你要填入的內容（必填）
- `[]` = 可選填（可省略）

另外有 6 個技能可以不用加 `/dhpk:` 前綴：`/change-verdict`、`/code-trace`、`/flow-guide`、`/flow-drive`、`/skill-forge`、`/skill-scope`。

## 先到哪裡：30 秒上手

1. 想先知道「現在該走哪條流程」：先輸入 **`/dhpk:flow-guide --mode classify`**。
2. 想直接解決一個問題但不知道去哪一列：看下方的「需求到入口」表。
3. 想快速找你要的 skill/command，先用本文的搜尋（Ctrl/Cmd+F）：直接找「`/dhpk:`」或「指令名稱」。

本文除了中文白話，也把「怎麼叫用」與「參數」拆給每一筆，適合第一次上手；
不熟悉參數的第一版建議直接複製「叫法」再貼到訊息裡，參數欄位可先留空。

## 2026-09-04 更新

- 資料欄位取自 `skills/*/SKILL.md` 與 `commands/*.md`
- 技能共 85 個、Slash command 共 29 個
- 內容已改成中文白話，著重「什麼情境會用到」與「參數怎麼填」

## 模型可先挑用（建議先看這區）

這些是模型可在對話中優先主動建議的項目，通常你只要描述需求，模型會幫你補齊前置內容。

| 技能 | 叫法 | 參數 | 參數白話說明 | 什麼情境會用 |
|---|---|---|---|---|
| [change-verdict](../skills/change-verdict/SKILL.md) | `/change-verdict`（或 `/dhpk:change-verdict`） | - | 不用特別給參數，直接說「幫我看這個變更」即可 | 幫你判斷 PR、修正、測試、文件是否有風險，最後出建議結果 |
| [code-trace](../skills/code-trace/SKILL.md) | `/code-trace`（或 `/dhpk:code-trace`） | - | 不用參數，直接給你要查的問題 | 查不懂的程式、錯誤、歷史脈絡，或要知道哪裡該找下一步 |
| [dhpk-agent-architecture-audit](../skills/dhpk-agent-architecture-audit/SKILL.md) | `/dhpk:dhpk-agent-architecture-audit` | - | 直接描述代理/模型流程異常症狀 | 系統有時候做事慢、輸出怪、模型套件包裹層有壞掉時，找結構問題 |
| [dhpk-agy-fast-worker](../skills/dhpk-agy-fast-worker/SKILL.md) | `/dhpk:dhpk-agy-fast-worker` | - | 直接給要做的任務與檔案範圍 | 把機械式、清楚定義的子任務交給可平行跑的 worker |
| [dhpk-codex-bridge](../skills/dhpk-codex-bridge/SKILL.md) | `/dhpk:dhpk-codex-bridge` | - | 直接說要請第二意見的主題 | 想要另一個模型視角做短命題判斷或比對輸出時使用 |
| [dhpk-composer-package-hygiene](../skills/dhpk-composer-package-hygiene/SKILL.md) | `/dhpk:dhpk-composer-package-hygiene` | - | 直接描述套件/版本問題 | 出版套件、公開 API、composer.json、版本規劃時做合規檢查 |
| [dhpk-create-request](../skills/dhpk-create-request/SKILL.md) | `/dhpk:dhpk-create-request` | - | 直接告訴你要建立/更新哪張 request | 建立追蹤請求檔、追進度、列出尚未完成項目 |
| [dhpk-deploy-list](../skills/dhpk-deploy-list/SKILL.md) | `/dhpk:dhpk-deploy-list` | - | 不用參數，依你提供的範圍直接產清單 | 產生部署/發佈檔案清單，方便對照一次要搬哪幾組檔 |
| [dhpk-fastapi-pro](../skills/dhpk-fastapi-pro/SKILL.md) | `/dhpk:dhpk-fastapi-pro` | - | 直接問 API/SQLAlchemy 審核需求 | 審查 FastAPI + SQLAlchemy 專案寫法與交易流程建議 |
| [dhpk-gitnexus-cli](../skills/dhpk-gitnexus-cli/SKILL.md) | `/dhpk:dhpk-gitnexus-cli` | - | 不用參數，告知你想做哪個動作 | 需要執行 GitNexus 命令、重建索引、更新 wiki 時使用 |
| [dhpk-gitnexus-debugging](../skills/dhpk-gitnexus-debugging/SKILL.md) | `/dhpk:dhpk-gitnexus-debugging` | - | 直接說錯誤訊息與現象 | 用 GitNexus 圖譜追查 bug、查呼叫者、做錯誤根因走向 |
| [dhpk-gitnexus-exploring](../skills/dhpk-gitnexus-exploring/SKILL.md) | `/dhpk:dhpk-gitnexus-exploring` | - | 不用參數，直接描述你不懂的功能 | 想知道某段程式如何運作、架構流程如何串起來 |
| [dhpk-gitnexus-guide](../skills/dhpk-gitnexus-guide/SKILL.md) | `/dhpk:dhpk-gitnexus-guide` | - | 不用參數 | 查 GitNexus 這套工具可用什麼指令、資料來源是什麼 |
| [dhpk-gitnexus-impact-analysis](../skills/dhpk-gitnexus-impact-analysis/SKILL.md) | `/dhpk:dhpk-gitnexus-impact-analysis` | - | 不用參數，直接給你要變更的符號/檔案 | 想改某個符號前，先看會影響到誰、影響範圍有多大 |
| [dhpk-gitnexus-refactoring](../skills/dhpk-gitnexus-refactoring/SKILL.md) | `/dhpk:dhpk-gitnexus-refactoring` | - | 直接描述你要重構的目標 | 需要大規模搬移/改名/拆分程式時，找安全順序 |
| [dhpk-harness-budget](../skills/dhpk-harness-budget/SKILL.md) | `/dhpk:dhpk-harness-budget` | - | 不用參數 | 你覺得對話上下文變重，或新增很多技能/規則後，要找節省 token 的地方 |
| [dhpk-ios-icon-gen](../skills/dhpk-ios-icon-gen/SKILL.md) | `/dhpk:dhpk-ios-icon-gen` | - | 不用參數，告訴我要替換哪個圖示 | 產生 iOS/macOS icon 素材（含圖片尺寸與設定檔） |
| [dhpk-ios-platform](../skills/dhpk-ios-platform/SKILL.md) | `/dhpk:dhpk-ios-platform` | - | 不用參數 | 查 iOS 平台安全/存取/SDK 使用的實作建議 |
| [dhpk-js-lint-config](../skills/dhpk-js-lint-config/SKILL.md) | `/dhpk:dhpk-js-lint-config` | - | 不用參數 | 決定 JS/TS 專案 lint 規則、globals、型別層級 |
| [dhpk-js-static-check-strategy](../skills/dhpk-js-static-check-strategy/SKILL.md) | `/dhpk:dhpk-js-static-check-strategy` | - | 不用參數 | 老舊 JS 專案想逐步加 `@ts-check` 與 lint 收斂，這個幫你做方案 |
| [dhpk-laravel-10-notes](../skills/dhpk-laravel-10-notes/SKILL.md) | `/dhpk:dhpk-laravel-10-notes` | - | 不用參數 | 查 Laravel 10 版本更新重點與踩雷 |
| [dhpk-laravel-11-notes](../skills/dhpk-laravel-11-notes/SKILL.md) | `/dhpk:dhpk-laravel-11-notes` | - | 不用參數 | 查 Laravel 11 版本差異、升級注意 |
| [dhpk-laravel-5-4-notes](../skills/dhpk-laravel-5-4-notes/SKILL.md) | `/dhpk:dhpk-laravel-5-4-notes` | - | 不用參數 | 查 Laravel 5.4 老專案的注意事項 |
| [dhpk-laravel-6-notes](../skills/dhpk-laravel-6-notes/SKILL.md) | `/dhpk:dhpk-laravel-6-notes` | - | 不用參數 | 查 Laravel 6 升級與常見相容性陷阱 |
| [dhpk-laravel-7-notes](../skills/dhpk-laravel-7-notes/SKILL.md) | `/dhpk:dhpk-laravel-7-notes` | - | 不用參數 | 查 Laravel 7 變更點與實作重點 |
| [dhpk-laravel-8-notes](../skills/dhpk-laravel-8-notes/SKILL.md) | `/dhpk:dhpk-laravel-8-notes` | - | 不用參數 | 查 Laravel 8 時期功能與架構差異 |
| [dhpk-laravel-9-notes](../skills/dhpk-laravel-9-notes/SKILL.md) | `/dhpk:dhpk-laravel-9-notes` | - | 不用參數 | 查 Laravel 9 變動，尤其 storage、mail、migrations 等 |
| [dhpk-laravel-mix-notes](../skills/dhpk-laravel-mix-notes/SKILL.md) | `/dhpk:dhpk-laravel-mix-notes` | - | 不用參數 | 查 Mix 5（webpack 時代）資源打包流程與問題 |
| [dhpk-laravel-package-author](../skills/dhpk-laravel-package-author/SKILL.md) | `/dhpk:dhpk-laravel-package-author` | - | 不用參數 | 打包 Laravel 套件（Service Provider、Facade、發布流程）時的參考 |
| [dhpk-laravel](../skills/dhpk-laravel/SKILL.md) | `/dhpk:dhpk-laravel` | - | 不用參數 | 想快速定位 Laravel 各版本與 Mix 差異的總表 |
| [dhpk-laravel-testbench-matrix](../skills/dhpk-laravel-testbench-matrix/SKILL.md) | `/dhpk:dhpk-laravel-testbench-matrix` | - | 不用參數 | 建/核對 Laravel package 的測試矩陣與測試策略 |
| [dhpk-legacy-characterization-tests](../skills/dhpk-legacy-characterization-tests/SKILL.md) | `/dhpk:dhpk-legacy-characterization-tests` | - | 不用參數 | 重構舊程式前，先建立「行為鎖定」測試 |
| [dhpk-library-dual-testsuite-map](../skills/dhpk-library-dual-testsuite-map/SKILL.md) | `/dhpk:dhpk-library-dual-testsuite-map` | - | 不用參數 | 你不確定該跑哪個測試集時，直接交給它快速對應 |
| [dhpk-matrix-cell-onboard](../skills/dhpk-matrix-cell-onboard/SKILL.md) | `/dhpk:dhpk-matrix-cell-onboard` | - | 不用參數（此技能不需手動參數） | 要新增一組 PHP/Laravel/PHPUnit/Monolog 的 CI cell 時用 |
| [dhpk-module-design](../skills/dhpk-module-design/SKILL.md) | `/dhpk:dhpk-module-design` | `"<question>" [--context <files>] [--mode design\|review\|compare\|adversarial] [--second-opinion=codex-exec]` | 先放主要問題；可加 `--context` 指定參考檔案；`--mode` 選用途 | 想做模組邊界、架構設計、設計複核、比較方案 |
| [dhpk-nextjs-15-5-notes](../skills/dhpk-nextjs-15-5-notes/SKILL.md) | `/dhpk:dhpk-nextjs-15-5-notes` | - | 不用參數 | 查 Next.js 15.5 的版本重點與升級要點 |
| [dhpk-nextjs-16-notes](../skills/dhpk-nextjs-16-notes/SKILL.md) | `/dhpk:dhpk-nextjs-16-notes` | - | 不用參數 | 查 Next.js 16 重點與 v15→v16 轉換 |
| [dhpk-openspec-artifact-guard](../skills/dhpk-openspec-artifact-guard/SKILL.md) | `/dhpk:dhpk-openspec-artifact-guard` | - | 不用參數 | 你正在改 OpenSpec 時，快速做格式/流程規範審核 |
| [dhpk-opsx-load-context](../skills/dhpk-opsx-load-context/SKILL.md) | `/dhpk:dhpk-opsx-load-context` | - | 不用參數 | 長作業恢復階段時，載入上一次上下文快照 |
| [dhpk-opsx-post-observation](../skills/dhpk-opsx-post-observation/SKILL.md) | `/dhpk:dhpk-opsx-post-observation` | - | 不用參數 | 長作業結束階段，儲存觀察紀錄到 claude-mem |
| [dhpk-php-8x-features](../skills/dhpk-php-8x-features/SKILL.md) | `/dhpk:dhpk-php-8x-features` | - | 不用參數 | 審查 PHP 8.x 功能能不能用、影響版本門檻 |
| [dhpk-php-modern-pro](../skills/dhpk-php-modern-pro/SKILL.md) | `/dhpk:dhpk-php-modern-pro` | - | 不用參數 | 判斷 PHP 7.4~8.x 雙版本程式庫該怎麼寫兼容 |
| [dhpk-php-runtime-router](../skills/dhpk-php-runtime-router/SKILL.md) | `/dhpk:dhpk-php-runtime-router` | - | 不用參數 | 先判斷目前專案是 Laravel、Symfony、PHP5.6 Yii 哪一條路線再做後續 |
| [dhpk-phpunit-9-modern](../skills/dhpk-phpunit-9-modern/SKILL.md) | `/dhpk:dhpk-phpunit-9-modern` | - | 不用參數 | 查 PHP 8.5+ 或 PHPUnit 9 的遷移與寫法 |
| [dhpk-phpunit-10-notes](../skills/dhpk-phpunit-10-notes/SKILL.md) | `/dhpk:dhpk-phpunit-10-notes` | - | 不用參數 | 查 PHPUnit 10 升級到 11 的轉換點 |
| [dhpk-phpunit-11-notes](../skills/dhpk-phpunit-11-notes/SKILL.md) | `/dhpk:dhpk-phpunit-11-notes` | - | 不用參數 | 查 PHPUnit 11 的新規則與棄用清單 |
| [dhpk-phpunit](../skills/dhpk-phpunit/SKILL.md) | `/dhpk:dhpk-phpunit` | - | 不用參數 | 在 9/10/11 版本間統整與決定該採用的 PHPUnit 流程 |
| [dhpk-polyfill-version-matrix-audit](../skills/dhpk-polyfill-version-matrix-audit/SKILL.md) | `/dhpk:dhpk-polyfill-version-matrix-audit` | - | 不用參數 | 多版本相依邏輯（version compare / class exists）有沒有寫全 |
| [dhpk-project-audit](../skills/dhpk-project-audit/SKILL.md) | `/dhpk:dhpk-project-audit` | `[--dir <path>]` | 只想掃整體，可不帶參數；若只掃某目錄加 `--dir` | 專案健康檢查，給你一組分數與明確改善項 |
| [dhpk-prompt-optimize](../skills/dhpk-prompt-optimize/SKILL.md) | `/dhpk:dhpk-prompt-optimize` | `"<raw prompt text>" [--model <name>]` | 將 `"..."` 換成你要優化的原始句子；可指定模型 | 想把一段指令改得更清楚、更好拿到你要的結果 |
| [dhpk-pytest-async](../skills/dhpk-pytest-async/SKILL.md) | `/dhpk:dhpk-pytest-async` | - | 不用參數 | 快速審查 asyncio + pytest-asyncio 測試寫法 |
| [dhpk-python-pro](../skills/dhpk-python-pro/SKILL.md) | `/dhpk:dhpk-python-pro` | - | 不用參數 | Python 3.10+ 專案品質建議（型別、錯誤處理、非同步） |
| [dhpk-python-static-checks](../skills/dhpk-python-static-checks/SKILL.md) | `/dhpk:dhpk-python-static-checks` | - | 不用參數 | 設定 Python 靜態檢查（ruff/pyright/mypy）怎麼開 |
| [dhpk-react-18-notes](../skills/dhpk-react-18-notes/SKILL.md) | `/dhpk:dhpk-react-18-notes` | - | 不用參數 | 查 React 18 版本重點，含 17→18/18→19 轉換概念 |
| [dhpk-react-19-notes](../skills/dhpk-react-19-notes/SKILL.md) | `/dhpk:dhpk-react-19-notes` | - | 不用參數 | 查 React 19 新功能與升級注意 |
| [dhpk-swift-language](../skills/dhpk-swift-language/SKILL.md) | `/dhpk:dhpk-swift-language` | - | 不用參數 | Swift 語言層面（並發、optional、錯誤）解法 |
| [dhpk-swift-test-strategy](../skills/dhpk-swift-test-strategy/SKILL.md) | `/dhpk:dhpk-swift-test-strategy` | - | 不用參數 | Swift 專案測試策略（unit/UI/async）規劃 |
| [dhpk-swiftui-architecture](../skills/dhpk-swiftui-architecture/SKILL.md) | `/dhpk:dhpk-swiftui-architecture` | - | 不用參數 | SwiftUI 架構（畫面狀態、導航、觀測）設計建議 |
| [dhpk-tdd-workflow](../skills/dhpk-tdd-workflow/SKILL.md) | `/dhpk:dhpk-tdd-workflow` | - | 不用參數 | 想用測試驅動（先寫失敗測試、再實作）的流程引導 |
| [dhpk-tech-spec](../skills/dhpk-tech-spec/SKILL.md) | `/dhpk:dhpk-tech-spec` | - | 不用參數 | 幫你寫/整理技術規格文檔 |
| [dhpk-vue-2-notes](../skills/dhpk-vue-2-notes/SKILL.md) | `/dhpk:dhpk-vue-2-notes` | - | 不用參數 | Vue 2（Option API）行為差異與注意點 |
| [dhpk-xcode-build-tooling](../skills/dhpk-xcode-build-tooling/SKILL.md) | `/dhpk:dhpk-xcode-build-tooling` | - | 不用參數 | iOS 打包/測試、Xcode build、SPM 命令與 lint 流程建議 |
| [dhpk-yii1-php56-development](../skills/dhpk-yii1-php56-development/SKILL.md) | `/dhpk:dhpk-yii1-php56-development` | - | 不用參數 | Yii 1.x/PHP5.6 專案在 controller/model/service 的實作與審查 |
| [dhpk-yii1-security-audit](../skills/dhpk-yii1-security-audit/SKILL.md) | `/dhpk:dhpk-yii1-security-audit` | - | 不用參數 | Yii 1.1 專案資安快速巡檢（CSRF、SQL、檔案上傳等） |
| [flow-guide](../skills/flow-guide/SKILL.md) | `/flow-guide`（或 `/dhpk:flow-guide`） | `--mode <classify/policy/next/checklist> [--go] [--feature <key>]` | `--mode` 先選模式；`classify` 先判斷任務種類，`policy` 看規則，`next` 要下一步，`checklist` 做收尾；可用 `--go` 直接往下走 | 幫你先判斷「現在該走哪條流程」 |
| [skill-scope](../skills/skill-scope/SKILL.md) | `/skill-scope`（或 `/dhpk:skill-scope`） | - | 不用參數 | 要做技能盤點（health/judge/stocktake/scout）時用 |

## 你必須手動叫用（模型不會主動代為選）

| 技能 | 叫法 | 參數 | 參數白話說明 | 什麼情境會用 |
|---|---|---|---|---|
| [dhpk-agy-commit](../skills/dhpk-agy-commit/SKILL.md) | `/dhpk:dhpk-agy-commit` | - | 不用參數，先說明變更為何需要拆批次 | 交給 agy 做「多個 commit 分批提交」的整合 |
| [dhpk-claude-health](../skills/dhpk-claude-health/SKILL.md) | `/dhpk:dhpk-claude-health` | `[--fix]` | 不加 `--fix` 僅診斷；加上會嘗試修復可自動修的設定 | 檢查 Claude plugin/專案設定是否健康 |
| [dhpk-cli-dispatch-context](../skills/dhpk-cli-dispatch-context/SKILL.md) | `/dhpk:dhpk-cli-dispatch-context` | - | 不用參數，直接交代要啟動哪個 provider context 流程 | 明確觸發 CLI context 分發，不走模型自動猜 |
| [dhpk-cli-transport](../skills/dhpk-cli-transport/SKILL.md) | `/dhpk:dhpk-cli-transport` | - | 不用參數 | 固定管道傳遞（底層安全/可稽核）任務時使用 |
| [dhpk-cross-agent-sync](../skills/dhpk-cross-agent-sync/SKILL.md) | `/dhpk:dhpk-cross-agent-sync` | - | 不用參數 | 比對 Codex / AGY / Cursor / Claude 的技能、指令一致性 |
| [dhpk-feasibility-study](../skills/dhpk-feasibility-study/SKILL.md) | `/dhpk:dhpk-feasibility-study` | - | 不用參數（這步不做實作） | 決定方案可行性、估風險、對比多個方向 |
| [dhpk-feature-verify](../skills/dhpk-feature-verify/SKILL.md) | `/dhpk:dhpk-feature-verify` | - | 不用參數 | 部署後驗證功能、檢查 API 與流程行為 |
| [dhpk-git-smart-commit](../skills/dhpk-git-smart-commit/SKILL.md) | `/dhpk:dhpk-git-smart-commit` | - | 不用參數 | 把亂七八糟變更切成多個邏輯 commit（明確規劃版控） |
| [dhpk-harness-fill](../skills/dhpk-harness-fill/SKILL.md) | `/dhpk:dhpk-harness-fill` | `[--layers <list>] [--dry-run] [<extra task description>]` | `--layers` 可限制要補齊哪些層；`--dry-run` 僅預覽 | 初始建置時補齊 `.claude/` 結構、規則、agents、hooks |
| [dhpk-harness-revise](../skills/dhpk-harness-revise/SKILL.md) | `/dhpk:dhpk-harness-revise` | - | 不用參數 | 專案已加很多新檔後，清理 harness 結構並輸出建議 |
| [dhpk-issue-analyze](../skills/dhpk-issue-analyze/SKILL.md) | `/dhpk:dhpk-issue-analyze` | - | 不用參數 | 深入分析 GitHub issue/PR 討論，整理根因與待辦 |
| [dhpk-onepassword-session](../skills/dhpk-onepassword-session/SKILL.md) | `/dhpk:dhpk-onepassword-session` | - | 不用參數 | 啟用 1Password CLI 工作階段，避免每次都要生物辨識 |
| [dhpk-opsx-apply-goal](../skills/dhpk-opsx-apply-goal/SKILL.md) | `/dhpk:dhpk-opsx-apply-goal` | `<change-id> [--turns N] [--max-duration <Nm\|Nh>] [--min-coverage N] [--worker=<claude\|codex\|agy\|auto>] [--smoke\|--no-smoke] [--dry-run]` | `<change-id>` 必填；其餘為執行策略限制 | 開新 session 要跑特定 change-id 的自動實作目標時 |
| [dhpk-project-setup](../skills/dhpk-project-setup/SKILL.md) | `/dhpk:dhpk-project-setup` | - | 不用參數 | 專案第一次啟用 dhpk：自動偵測框架、初始化設定 |
| [dhpk-release-creator](../skills/dhpk-release-creator/SKILL.md) | `/dhpk:dhpk-release-creator` | `<version>` | `<version>` 填版本號（例如 `1.2.3`） | 產生版本升級流程（更新版本檔、變更日誌、PR 等） |
| [dhpk-repo-intake](../skills/dhpk-repo-intake/SKILL.md) | `/dhpk:dhpk-repo-intake` | - | 不用參數 | 首次整理一個新 repo 的索引與目錄清單 |
| [dhpk-session-usage-audit](../skills/dhpk-session-usage-audit/SKILL.md) | `/dhpk:dhpk-session-usage-audit` | `[--date YYYY-MM-DD \| --from YYYY-MM-DD --to YYYY-MM-DD] [--agent NAME] [--format text\|json] [--create-issues]` | 可限制時間、指定 agent、輸出格式，`--create-issues` 產生 issue 追蹤 | 想知道某段時間內模型/agent 哪裡在工作、是否有漏掉項目 |
| [flow-drive](../skills/flow-drive/SKILL.md) | `/flow-drive`（或 `/dhpk:flow-drive`） | - | 不用參數 | 任務已經確認要實作時，用此進入固定交付流程 |
| [skill-forge](../skills/skill-forge/SKILL.md) | `/skill-forge`（或 `/dhpk:skill-forge`） | `<create/distill-rules> [target]` | `create` 建新技能；`distill-rules` 將重複原則抽成 rule；`target` 可指定對象 | 建立新技能或提煉重複原則時使用 |

## Slash Command（全部屬於「你手動叫用」）

這一區的命令都要你明確輸入 `/dhpk:` 或 `/dhpk` alias 對應指令。

| 指令 | 叫法 | 參數 | 參數白話說明 | 什麼情境會用 |
|---|---|---|---|---|
| [check-coverage](../commands/check-coverage.md) | `/dhpk:check-coverage` | - | 不用參數（舊轉接） | 舊版入口，現在建議用新的對應命令 |
| [codex-test-gen](../commands/codex-test-gen.md) | `/dhpk:codex-test-gen` | - | 不用參數（舊轉接） | 舊版測試生成入口，建議改走新版 TDD 流程 |
| [create-pr](../commands/create-pr.md) | `/dhpk:create-pr` | `[--head <branch>] [--base <branch>] [--title <text>] [--execute] [--dry-run]` | `--head` 來源分支，`--base` 目標分支，`--title` 自訂題名，`--dry-run` 先模擬 | 準備並發起 Pull Request |
| [create-release](../commands/create-release.md) | `/dhpk:create-release` | `<version> [--execute]` | `version` 直接填版本號，預設通常先產生預覽 | 建立新發布版本（更新版本號、changelog、tag） |
| [deep-analyze](../commands/deep-analyze.md) | `/dhpk:deep-analyze` | `<initial proposal description or file path>` | 一段需求文字或規格檔路徑皆可，先做全面分析 | 需求深入分析與完整規格制定 |
| [dep-audit](../commands/dep-audit.md) | `/dhpk:dep-audit` | `[--level <severity>] [--fix]` | `--level` 選擇警報門檻，`--fix` 嘗試修正可修項目 | 專案相依性套件安全性與健康度稽核 |
| [doc-refactor](../commands/doc-refactor.md) | `/dhpk:doc-refactor` | `<file path>` | 指定要整理的文件路徑 | 長篇文件或技術文檔重構整理 |
| [git-worktree](../commands/git-worktree.md) | `/dhpk:git-worktree` | `[add\|list\|remove\|prune] [--branch <name>] [--base <ref>]` | 選擇行為；`add` 時可加分支與基底 | 管理獨立的 Git worktree 工作目錄 |
| [harness-audit](../commands/harness-audit.md) | `/dhpk:harness-audit` | `[scope] [--format text\|json] [--root <path>]` | `scope` 可指定檢查範圍，`--format` 指定輸出格式 | 檢查 harness 結構與配置完整度 |
| [harness-govern](../commands/harness-govern.md) | `/dhpk:harness-govern` | `[--fix] [--scope repo\|skills\|rules\|mcp]` | 想一次做套件治理時用，`--fix` 可直接建議修正 | 套件與 harness 規範一致性治理 |
| [install-hooks](../commands/install-hooks.md) | `/dhpk:install-hooks` | - | 不用參數（舊轉接） | 舊版安裝 hooks 入口，建議用 setup/指令族 |
| [install-rules](../commands/install-rules.md) | `/dhpk:install-rules` | - | 不用參數（舊轉接） | 舊版安裝 rules 入口 |
| [install-scripts](../commands/install-scripts.md) | `/dhpk:install-scripts` | - | 不用參數（舊轉接） | 舊版安裝 scripts 入口 |
| [matrix-cell-onboard](../commands/matrix-cell-onboard.md) | `/dhpk:matrix-cell-onboard` | `"<php-version> <laravel-version> [phpunit] [monolog]"  e.g. "8.3 12 11 3"` | 例如 `"8.3 12 11 3"`，依序填 PHP、Laravel、PHPUnit、Monolog 版本 | 為 PHP/Laravel 矩陣新增測試 cell |
| [merge-prep](../commands/merge-prep.md) | `/dhpk:merge-prep` | `<source-branch> [--target <branch>]` | `source-branch` 必填；`target` 指合併目標 | 分支合併前檢查與衝突排查 |
| [opsx-apply-resume](../commands/opsx-apply-resume.md) | `/dhpk:opsx-apply-resume` | `[change-id]` | 不填就用目前上下文；填入 change-id 可精準續作 | 長時間 OpenSpec 工作階段 context 復原與交接 |
| [precommit](../commands/precommit.md) | `/dhpk:precommit` | `[--fast]` | 不加參數全量流程；`--fast` 為快速模式 | 提交前執行完整檢查與門檻測試 |
| [precommit-fast](../commands/precommit-fast.md) | `/dhpk:precommit-fast` | - | 不用參數（舊轉接） | 舊版快捷 pre-commit 入口 |
| [project-brief](../commands/project-brief.md) | `/dhpk:project-brief` | `<tech spec path> [--output <output path>]` | 指定技術規格檔，必要時指定輸出路徑 | 從技術規格產生專案執行摘要簡報 |
| [pr-summary](../commands/pr-summary.md) | `/dhpk:pr-summary` | `[--author <user>] [--label <label>]` | 可用作者或標籤篩選 PR 清單 | 總結 PR 內容與狀態 |
| [review-pending](../commands/review-pending.md) | `/dhpk:review-pending` | `"[--files \"<rel-path,...>\"]"` | 可指定一批相對路徑，省掉整批手動挑檔 | 對暫存或指定清單進行批次 review |
| [setup](../commands/setup.md) | `/dhpk:setup` | `[--show] [--install hooks\|rules\|scripts\|all] [--dry-run] [--force]` | 先 `--show` 看現況，需安裝時再指定類型 | 初始化專案 harness 與工具設定 |
| [simplify](../commands/simplify.md) | `/dhpk:simplify` | `<file or directory>` | 指定要簡化的檔案或整個資料夾 | 簡化程式碼與移除死碼 |
| [smart-commit](../commands/smart-commit.md) | `/dhpk:smart-commit` | `[--scope <path>] [--type <type>] [--ai-co-author]` | `scope` 只掃某路徑；`type` 指 commit 類型；`--ai-co-author` 加 AI 共作署名 | 智慧分批提交 commit |
| [spec-mine](../commands/spec-mine.md) | `/dhpk:spec-mine` | `[capability or path to mine first]` | 指定要先挖哪個能力或哪個路徑 | 從既有程式庫中挖掘規格需求 |
| [ui-ux-verify](../commands/ui-ux-verify.md) | `/dhpk:ui-ux-verify` | `[<url>] [spec:<path>]` | 可只給網址，也可加 `spec:` 指定 spec 檔 | 驗證網頁 UI/UX 符合規格 |
| [update-codemaps](../commands/update-codemaps.md) | `/dhpk:update-codemaps` | - | 不用參數（會重掃專案） | 重新建立代碼地圖快取 |
| [update-docs](../commands/update-docs.md) | `/dhpk:update-docs` | `<docs-path \| workflow-keyword>` | 指定文件路徑或工作流關鍵字 | 根據變更同步更新相關文件 |
| [verify](../commands/verify.md) | `/dhpk:verify` | `[fast\|full] [--integration <path>] [--e2e <path>]` | `fast` 快速驗證、`full` 完整；可補上測試路徑 | 全流程跑前想先做驗證門檻時 |

## 需求到入口（非專案人員一頁直達）

| 你現在的需求 | 推薦起手 |
|---|---|
| 我不知道先做哪個 | `/dhpk:flow-guide --mode classify` |
| 我要先確認這個方向可不可行 | `/dhpk:dhpk-feasibility-study` |
| 我發現 bug，要找原因 | `/dhpk:code-trace` |
| 我已經要開始實作 | `/flow-guide --mode next --go` 或 `/flow-drive` |
| 我要請模型幫我做檔案清單／專案盤點 | `/dhpk:dhpk-project-audit`、`/dhpk:dhpk-deploy-list` |
| 我要做正式發布動作前檢查 | `/dhpk:setup`、`/dhpk:verify`、`/dhpk:harness-audit` |

## 給第一次使用者的 5 步（建議）

1. 不確定要用哪一類：先用 **`/dhpk:flow-guide --mode classify`**。
2. 要先確認可行性：**`/dhpk:dhpk-feasibility-study`**（明確叫用）。
3. 要知道架構或實作方向：**`/dhpk:dhpk-module-design`**。
4. 要寫文檔、規格：**`/dhpk:dhpk-tech-spec`**、**`/dhpk:doc-refactor`**。
5. 要落地實作：**`/flow-guide --mode next --go`**（或 `/flow-drive`）。
