# dhpk 技能與 Slash Command 快速速查

這是一頁式入口圖，不是技能 procedure 的複本。完整的 65 個 canonical package
請看 [`skills/INDEX.md`](../skills/INDEX.md)；Codex 的參數與可用性請看
[`Codex 技能參數發現`](./codex-skill-usage.zh-TW.md)。

符號約定：`<>` 是必填值，`[]` 是可省略值。Claude 使用
`/dhpk:<name>`；Codex 先用 `$flow-guide help`，再使用查到的
`$<public-name>`。

## 30 秒選入口

| 你要做什麼 | 先用什麼 | 邊界 |
|---|---|---|
| 不知道有哪些技能或參數 | `$flow-guide help`；單一技能用 `$flow-guide help <skill>` | 只讀 metadata，不載入 procedure 或執行目標 |
| 不知道該走哪條流程 | `$flow-guide route <task>` | 只給 route report；加 `--go` 最多 handoff 一個可用的 implicit target |
| 查政策、下一步或收尾 | `$flow-guide rules <query>`、`next <query>`、`close <query>` | 只讀 guidance，不取得 implementation 或 Git authority |
| 已有確認的 specification/change | `$flow-drive <confirmed-spec-or-change-id>` | explicit-only、無 mode；只負責 implementation |
| 還沒有 proposal 或 OpenSpec artifacts | 外部 `$openspec-propose`，再依流程使用 `/opsx:apply` | proposal authoring 不屬於 `flow-drive` |
| 要分組 Git commit | `$dhpk-git-smart-commit` | `git-smart-commit` stable ID 與 public name 保持不變；需要明確 Git authority |

## 九個 portable family

family 名稱刻意不加 `dhpk-` 前綴；其他 first-party skill 維持 collision-safe 的
`dhpk-*` 名稱。每個 family 只保留一個窄入口，mode/selector 由 usage card 揭露。

| Family | 何時使用 | 可用 action / selector | 不負責 |
|---|---|---|---|
| [`skill-scope`](../skills/skill-scope/SKILL.md) | 稽核、比較或盤點技能治理 | `health`、`judge`、`stocktake`、`scout` | 不直接 author skill |
| [`skill-forge`](../skills/skill-forge/SKILL.md) | 建立技能或提煉 agent rule | `create`、`distill-rules` | 不替應用程式實作功能 |
| [`flow-guide`](../skills/flow-guide/SKILL.md) | 需要 usage、路由、政策、下一步或收尾建議 | `help`、`route`、`rules`、`next`、`close` | 不執行 explicit-only target |
| [`flow-drive`](../skills/flow-drive/SKILL.md) | specification、目標與 acceptance 已確認 | 無 mode；confirmed change/spec | 不分類、選 route、author proposal 或 release |
| [`change-verdict`](../skills/change-verdict/SKILL.md) | 對 code、PR、security、tests、docs 或 risk 做唯讀判斷 | `code`、`pr`、`security`、`tests`、`docs`、`risk` | 不代替修復或 commit |
| [`code-trace`](../skills/code-trace/SKILL.md) | 探索程式、診斷、查歷史或選工具 | `explore`、`diagnose`、`history`、`select-tool` | 不在未確認根因時直接修復 |
| [`laravel`](../skills/laravel/SKILL.md) | Laravel 版本相容性與實作指引 | `5.4`、`6`、`7`、`8`、`9`、`10`、`11`、`mix` | 不再使用版本 note skill 名稱 |
| [`phpunit`](../skills/phpunit/SKILL.md) | PHPUnit 版本與測試相容性 | `9`、`10`、`11` | 不再使用版本 note skill 名稱 |
| [`harness-govern`](../skills/harness-govern/SKILL.md) | harness 健康、預算、補齊、修訂或同步 | `health`、`budget`、`fill`、`revise`、`sync` | 不拆回五個窄 predecessor |

## 已確認 implementation 的參數

先查 `$flow-guide help flow-drive`，再按需要加入 modifier：

```text
$flow-drive <change-id> --plan
$flow-drive <change-id> --plan=opus:xhigh
$flow-drive <change-id> --worker=claude|codex|agy|auto
$flow-drive <change-id> --reasoner=codex:gpt-5.6-sol:high
$flow-drive <change-id> --architect
$flow-drive <change-id> --no-architect
```

`--codex` 是退休 diagnostic，不會選 hidden peer。`flow-guide route` 的
`--go` 只適用於一次 bounded handoff；不要把它當成 implementation shortcut。

## 仍常用的窄技能

這些技能保留原有能力，只有在觸發邊界成立時才明確呼叫：

| 技能 | 觸發 | 主要邊界 |
|---|---|---|
| [`dhpk-tdd-workflow`](../skills/dhpk-tdd-workflow/SKILL.md) | 需要 tests-first RED/GREEN/REFACTOR | 不負責瀏覽器旅程或未確認的需求 authoring |
| [`dhpk-module-design`](../skills/dhpk-module-design/SKILL.md) | 需要 module boundary、deep-module 或 architecture decision | 不取代 OpenSpec proposal owner |
| [`dhpk-php-runtime-router`](../skills/dhpk-php-runtime-router/SKILL.md) | PHP/Laravel/Symfony/Yii runtime 需要分流 | 先判斷 runtime，再載入一條 reference |
| [`dhpk-yii1-php56-development`](../skills/dhpk-yii1-php56-development/SKILL.md) | Yii 1.x / PHP 5.6 backend 工作 | 不用於前端或非 PHP 專案 |
| [`dhpk-yii1-security-audit`](../skills/dhpk-yii1-security-audit/SKILL.md) | Yii 1.1 安全白盒審計 | 不用於 Yii2 或非 PHP 專案 |
| [`dhpk-legacy-characterization-tests`](../skills/dhpk-legacy-characterization-tests/SKILL.md) | 重構前鎖定 legacy behavior | 不代替功能設計或一般 TDD |

Git、release、setup、review 與其他 slash command 的完整清單在
[`commands/INDEX.md`](../commands/INDEX.md)。

## 0.54 退役與 operator 邊界

- `git-smart-commit` 保留原 stable ID/public name；`agy-commit` 退役，不產生 alias。
- Laravel/PHPUnit version note 名稱改由 family selector 承接。
- `claude-health`、`harness-budget`、`harness-fill`、`harness-revise`、
  `multi-ai-sync` 改由 `harness-govern` modes 承接。
- `feasibility-study`、`tech-spec`、`create-request` 不再是 dhpk discovery
  skill；提案交給外部 `$openspec-propose`，方案比較見
  [`feasibility comparison guidance`](./agent-guidance/feasibility-comparison.md)。
- `op-session` 不再是 skill；需要登入時由 operator 在 terminal 執行 `op signin`。

完整 21 筆 predecessor → replacement 對照、reason code 與 rollback pin 見
[`skill-platform-migration.zh-TW.md`](./skill-platform-migration.zh-TW.md#目前-054-capability-families-與-retirement)。
歷史 0.47、0.52、0.53 ledger 保留在遷移文件，不代表目前可用 alias。

## Profile 與證據

目前 profile 為 `minimal=8`、`full=55`、`compat-v1=62`；Agent Plugin、Cursor
與 AGY publication surface 各有 37 個 selected stable ID。Local usage card 或
catalogue 只證明 metadata 已產生，不代表 skill runtime、測試、deployment、commit
或 release 已完成；交接時分開標示 `PASS`、`BLOCKED`、`NOT_RUN`、`UNAVAILABLE`。
