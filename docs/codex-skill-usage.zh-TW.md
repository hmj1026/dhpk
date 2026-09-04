# Codex 技能參數發現

當專案已同步 dhpk 的 Codex projection、但不確定參數時，先用下面的
`flow-guide` metadata 查詢。命令輸出以目前 inventory revision 為準；本頁只說明
怎麼查與各入口的邊界。

## 查可用語法

```text
$flow-guide help
$flow-guide help flow-guide
$flow-guide help flow-drive
$flow-guide help dhpk-git-smart-commit
```

`help` 只讀 metadata：列出可由 Codex 呼叫的 public name，或回傳單一 usage card，
其中包含 syntax、有限的 action、option、authority 與 examples。它不會載入目標
procedure、不會執行目標、不會修改檔案、不會 stage commit，也不會授予 authority。
產生的 catalogue 是
[`../skills/flow-guide/references/codex-usage-catalog.json`](../skills/flow-guide/references/codex-usage-catalog.json)。

若 `$flow-guide` 沒被發現，先確認 project-local projection 與 receipt：

```bash
test -f .codex/.dhpk-installed.json
test -e .codex/skills/flow-guide/SKILL.md
```

再從 persistent dhpk checkout 重跑支援的 installer：

```bash
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" --update
```

`codex plugin list` 只是管理層證據，不代表 skill 已被 discovery。缺少 Codex CLI
或 custom-role registry 時，應分開回報；不能從靜態 projection 推論 runtime 支援。

## 主要入口

| 目的 | 呼叫方式 | 邊界 |
| --- | --- | --- |
| 查參數 | `$flow-guide help [skill]` | 只讀 metadata，不執行目標 |
| 取得路由建議 | `$flow-guide route <task>` | 只建議；加 `--go` 最多 handoff 一個 implicit target |
| 查政策 | `$flow-guide rules <phase-or-question>` | 只讀 policy lookup |
| 找下一步 | `$flow-guide next <change-or-worktree>` | 依證據給一個 next route |
| 收尾檢查 | `$flow-guide close <change-or-worktree>` | 只做 checklist，不宣稱 commit/release |
| 實作已確認工作 | `$flow-drive <change-id-or-confirmed-spec>` | explicit-only、無 mode 的 implementation |
| 分組 commit | `$dhpk-git-smart-commit` | 保留的獨立 commit owner；具明確 Git authority |

`flow-guide` 只有五個 action：`help`、`route`、`rules`、`next`、`close`。舊的
`--mode classify|policy|checklist` 與 `flow-drive:author` 形狀已退休。`flow-drive`
不負責 authoring proposal，也不負責選 route；如果還沒有 proposal、design 或 task set，
請使用外部 `$openspec-propose` skill。

## 實作 modifiers

先查 exact card，再加入 modifier。已確認的 implementation entry 只接受下列選項：

```text
$flow-drive <change-id> --plan
$flow-drive <change-id> --plan=opus:xhigh
$flow-drive <change-id> --worker=claude|codex|agy|auto
$flow-drive <change-id> --reasoner=codex:gpt-5.6-sol:high
$flow-drive <change-id> --architect
$flow-drive <change-id> --no-architect
```

`--codex` 是退休 diagnostic，不會選 hidden peer。其餘 worker/reasoner 值與 skill
專屬 option 以產生出的 card 為準。

## Family selector

九個 portable family 是 `skill-scope`、`skill-forge`、`flow-guide`、`flow-drive`、
`change-verdict`、`code-trace`、`laravel`、`phpunit`、`harness-govern`。使用
`$flow-guide help <family>` 取得目前語法。

- `skill-scope`：`health`、`judge`、`stocktake`、`scout`。
- `skill-forge`：`create`、`distill-rules`。
- `change-verdict`：`code`、`pr`、`security`、`tests`、`docs`、`risk`。
- `code-trace`：`explore`、`diagnose`、`history`、`select-tool`。
- `laravel`：selector `5.4`、`6`、`7`、`8`、`9`、`10`、`11`、`mix`。
- `phpunit`：selector `9`、`10`、`11`。
- `harness-govern`：`health`、`budget`、`fill`、`revise`、`sync`。

`git-smart-commit` 保留原 public name，是獨立 owner；`agy-commit` 已退休。需要 AGY
時，依 commit owner 的文件明確選 AGY worker。版本 notes、harness、feasibility、
request ticket 與 OnePassword predecessor 都不是 alias。

## Operator-only 驗證

需要 OnePassword 驗證時，由 operator 在 terminal 執行 `op signin`，並以 provider
自己的輸出確認 session。不要把 session token、vault 值或 login output 放進 prompt、
generated catalogue、receipt 或 commit。

從 0.53.0 升級時，operator 也必須執行 `op signout`、確認沒有 process 仍依賴舊
session，再依 operator 的安全檔案流程移除 legacy `~/.op-claude-session` cache，
且不得輸出其內容。Installer 與 agent 不會自動檢查或刪除該檔案。

## 證據邊界

Usage card 只證明 metadata 已產生並通過驗證，不代表 skill 已執行、worker 可用、測試
通過、projection 已在 runtime 載入，或 release 已發布。交接時要分開標示
`PASS`、`BLOCKED`、`NOT_RUN`、`NOT_CONFIGURED`、`UNAVAILABLE`。
