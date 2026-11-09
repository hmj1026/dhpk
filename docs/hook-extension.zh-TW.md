# Hook extension model

> **語言**：[English](./hook-extension.md) · **繁體中文**

dhpk 刻意只註冊精簡的預設 lifecycle。完整 mapping 以
[`hooks/hooks.json`](../hooks/hooks.json) 為準：

| Event | Script | 確定性責任 |
|---|---|---|
| `PreToolUse(Edit\|Write\|MultiEdit)` | `pre-edit-guard.sh` | 受保護路徑與 secret safety |
| `PreToolUse(Bash)` | `pre-bash-dispatch.sh` | shell safety 加 Git branch-safety gate |
| `SessionStart` | `session-start.sh` | 驗證並啟用設定的 module |
| `SubagentStop` | `subagent-stop-verify.sh` | 清理已停止 fast-worker 的 liveness state；並將每個 subagent 的 model（transcript 最後一則 assistant 的 model）與 effort（hook 輸入值，可能是 session 層級）附加寫入 `.claude/artifacts/sessions/subagent-dispatch.jsonl`，不產生任何輸出 |

`session-start.sh` 只啟用 module；
不建立 snapshot、不探測 Docker、不檢查安裝健康、不注入 prompt hint，也不輸出
orchestration 建議。

## Credential read 保護

Claude `PreToolUse(Bash)` dispatcher 會檢查抵達 gate 的呼叫，包含抵達同一
gate 的 subagent 呼叫。其他 Host、Read 或 MCP 工具，以及此整合之外的 shell
命令不在涵蓋範圍。Bash gate 需要 Python 3；缺少時回傳 exit 2 並阻擋。

預設保護 basename `.env`、`.env.*`、`my.cnf`、`debian.cnf`、`*.pem`、
`id_rsa*` 與 `credentials*`。只有完全相同的 `.env.example`、`.env.sample`、
`.env.dist`、`.env.template` 不受預設 `.env` 規則限制；帶後綴的變體不豁免，
自訂規則也可保護 template。`.pem` 與 `id_rsa*` 刻意包含看似公開的檔案。

`credential_read_paths` 的 plugin string option 使用字串 JSON array；project
settings 也可使用原生 array。規則只會增加預設保護；無效設定會阻擋 gate。
例如，JSON 字串可保留空格：

```json
{"pluginConfigs":{"dhpk@dhpk":{"options":{"credential_read_paths":["private keys/*", "custom.secret"]}}}}
```

不含 `/` 的 pattern 比對任何深度的 basename；含 `/` 的相對 pattern 比對完整
path-component 後綴；絕對 pattern 比對正規化後的完整路徑。`*` 與 `?` 不跨越
`/`。Literal `.`、`..`、重複分隔符及 shell quoting 採詞法正規化，不開啟目標。
相同規則適用於支援的 literal SSH operand，遠端路徑不依本機檔案系統解析。

有限 parser 涵蓋 `cat`、`less`、`head`、`tail`、`sed`、`awk`、`grep`、`rg`，
包含選項、多個目標、輸入 redirection、pipeline、命令分隔符與 literal SSH
命令。每個目標獨立判斷；允許的 template 或 metadata 命令不會豁免同一命令中
其他受保護讀取。單純 `ls`、`stat` 與一般讀取仍允許。遞迴內容搜尋若可能涵蓋
受保護路徑時，每項規則須有明確 exclusion，或經有界本機掃描證明所有根目錄
皆無符合的受保護路徑。只有針對有效最終
component 的全域精確 basename exclusion 或 `*` 可作此證明；ignore、reinclude
不能證明排除。掃描計算所有項目，不模擬 ignore 規則；錯誤、超過 20,000 項或
300 ms 時阻擋。遠端命令與未知工作目錄仍須完整排除。掃描檢查連結與目標，
不跟隨內部目錄連結時略過，會跟隨時阻擋。掃描後新增檔案的時間差風險已接受。
本機 `rg` 的一般非 symlink 檔案可用 `lstat` 判斷，但有
檢查與使用之間的時間差。可辨識的受保護讀取若語法無法安全分類則阻擋；檢查時
不執行或展開提交的 shell 文字。

支援且完整的 heredoc 若 delimiter 有引用，內文視為資料；未引用時檢查有效的命令
替換。含歧義的 delimiter、同一行多個 heredoc 與內文續行會採保守阻擋；heredoc
前後命令及受保護的寫入目標仍受原有 gate 檢查。遞迴搜尋可使用
`rg --glob '!pattern'` 或 `grep --exclude='pattern'` 排除所有預設與自訂保護規則，
或指定明確的非保護檔案；Grep/Read 工具僅在可用時作為替代方案。

### git 讀取

下列 git 用法也算 reader：

- `git grep`、`show`、`cat-file -p`（或 `cat-file <type>`）、`diff`、`blame`、`stash show`；
- 帶 `-p`、`--patch`、`-U`、`--cc` 或 `-L` 的 `log`、`whatchanged`、`reflog`、`stash list`、`diff-tree`、`diff-index`、`diff-files`。

以下情況仍允許：

- 只輸出名稱或統計的用法（`--stat`、`--name-only`、`--name-status`、`--numstat`、`-s`）；
- 其他子指令，例如 `status`、`add`、`commit`。

判定規則：

- `<rev>:<path>`、`blame` 的檔案、`log -L` 的檔案，以及字面 pathspec，都當成讀取目標判定。`HEAD:path` 與 `:path` 以 repository 根目錄為基準；`HEAD:./path` 以工作目錄為基準。
- 下列情況視為無法確定目標：pathspec 含 `*`、`?`、`[`；值是動態組出的；帶 exclude 以外的 magic；只給 blob id。blob 請改用 `<rev>:<path>` 讀取。
- 指令沒有指名檔案時（`git diff`、`git show <commit>`、`git log -p`、`git grep x`），gate 會用相同的 revision、限制條件與 pathspec，執行一次只列名稱的 git 列舉，再逐一判定列出的路徑。
  - git 讀取不接受 exclusion 證明。
  - 列舉同樣受 300 ms 與 20,000 項上限約束；超過時請縮小 pathspec 或加上 `-n`。
- 列舉一律帶 `--no-pager --no-ext-diff --no-textconv`、`core.fsmonitor=false`、`core.hooksPath=/dev/null`，並以空 tree 作為 `--attr-source`。列舉也會設定 `core.attributesFile=/dev/null`、`GIT_ATTR_NOSYSTEM=1` 與 `log.showSignature=false`，把每個已設定的 `filter.<driver>` 覆寫成空指令；diff 列舉另帶 `--ignore-submodules=all`，不會在 submodule 內啟動子 git。因此不會執行 repository 設定的外部 diff、textconv、clean／smudge filter、pager、fsmonitor、簽章驗證或 hook 程式。
- 依賴列舉的判定需要 git 2.40 以上；較舊的 git 會讓列舉失敗並阻擋。git 2.44 之前，partial clone 在列舉時可能抓取缺少的物件。
- copy 偵測（`-C`、`--find-copies`）與 `--submodule` 不支援。設定了 `diff.submodule=diff` 的 repository 會阻擋 work tree 與歷史的 diff。
- `git -C <字面目錄>` 照 `cd` 的方式解析。git 讀取若帶有下列任一項會被阻擋：
  - `--git-dir`、`--work-tree`、`--namespace`、`-c`、`--config-env`（`-c alias.*` 不論子指令一律阻擋）；
  - `GIT_DIR=`、`GIT_WORK_TREE=`、`GIT_INDEX_FILE=` 等改變 repository 位置的前綴。

  `GIT_PAGER=cat` 仍允許。

不在 reader 清單內的指令不受檢查，例如 `python`、`node`、`xxd`、`base64`、`cp`，以及 git alias、`git archive`、`git format-patch`、`git bundle`、`git difftool`。git 代為執行的 reader 仍會判定，例如 `git bisect run cat .env` 或 `git submodule foreach cat .env`。

### 阻擋原因

被阻擋的命令以 exit 2 結束，stderr 為一行
`[bash-guard] blocked: <原因>[: <細節>]; <修正指引>`。原因有五種：

| 原因 | 何時出現 |
| --- | --- |
| `protected path` | 目標、輸入 redirect 或輔助檔（如 `grep -f`）是受保護路徑 |
| `ambiguous read target` | 目標無法靜態確定：glob、動態值，或 `ssh` 後的 glob／動態值 |
| `unsupported reader syntax` | reader 的選項無法安全解析；細節只列出選項名稱 |
| `recursive read without credential exclusions` | 遞迴讀取沒有完整排除，且本機掃描無法證明不含受保護路徑 |
| `credential inspection failure` | payload 或政策設定無效，或檢查本身出錯 |

修正指引只列出實際使用的 reader 的排除語法：`rg` 為 `--glob "!pattern"`，
`grep` 為 `--exclude="pattern"`。

### 受控擷取

本機受保護檔案若只包含支援的 MySQL PDO DSN，gate 只辨識一個簡單呼叫，使用
hook 所用 Python 的絕對路徑與已安裝 helper 的絕對路徑：

```text
/absolute/path/to/python3 -I -S /absolute/installed/plugin/scripts/hooks/credential-extract.py --file /absolute/path/to/file --fields host,dbname
```

`--fields` 僅接受 `host`、`dbname` 或 `host,dbname`；不可加環境變數前綴、
wrapper、組合命令、redirection 或其他輸出選項。Gate 確認已安裝 helper 是一般
非 symlink 檔案且符合固定 digest。整個檔案必須是 MySQL PDO DSN，含唯一的
`host` 與 `dbname`，可含經驗證的 `port`、`charset`；不支援或有歧義的輸入不輸出
擷取結果。Helper 只輸出所請求欄位的 JSON。檔案必須是最多 1024 bytes 的一般檔案；絕對路徑
不可有 symlink、空白 component、`.` 或 `..` component。ASCII DSN 可在結尾有
一個 LF；分號分隔欄位可為任意順序，不可有額外欄位或結尾分號。`host` 符合
`[A-Za-z0-9][A-Za-z0-9._-]{0,252}`，`dbname` 符合 `[A-Za-z0-9_]{1,64}`，
`charset` 符合 `[A-Za-z0-9_]{1,32}`，`port` 為 1–65535 且不可有前導零。
v1 不支援 PHP 設定或 SSH 擷取；
helper 不執行 PHP 或 source 檔案。遭阻擋時可在支援的情況下使用本機受控擷取，
或請使用者提供非機密資訊。診斷不會回顯命令、設定值或檔案內容。

此詞法 guard 不是完整的資料外洩防護：動態路徑、alias、symlink 目標、編碼命令、
任意 interpreter 與 script 內容都未證明受到涵蓋。同 UID 的並行變更及已安裝檔案
的信任不在此界線內。測試應使用假資料；本機 hook 測試不能證明 Claude parent 或
subagent 實際啟動了 hook。

## Bash 外層上限

Bash `PreToolUse` command 宣告 `timeout: 2100` 與 `onFailure: "block"`。
Claude Code 2.1.295 與更新版本可以在這個 hook 逾時或無法執行時阻擋觸發的命令。
更舊版本不被宣稱具有相同的 fail-closed 行為。這份宣告不是已量測的 2100 秒等待。

`Edit|Write|MultiEdit` guard 同樣宣告 `onFailure: "block"`，`timeout` 為 5。
Claude Code 2.1.295 與更新版本會對這個 guard fail-close：hook 失敗或逾時就阻擋編輯。
更舊的 Claude Code 會忽略 `onFailure`，因此 guard 失敗或逾時仍會讓編輯繼續。

支持的預設範圍是 JS、Python、Swift、PHP 各一個 commit root，該 root 上一個
Python project group，以及 Swift build/test 設定不高於 360/480 秒。內層
deadline 加每次 1 秒 grace 是 JS 212、Python 255、Swift 842、PHP 423，合計
1732 秒。剩下的 368 秒留給準備與清理。沒有內層 deadline 的步驟不在這個合計裡。
更多 root、更多 group、更大的 Swift override，或任何到達上限的執行都可能被
中斷。被中斷或未完成的檢查不是 PASS，觸發的 Bash 命令也不會越過這個上限被放行。
內層 deadline 維持不變。`SubagentStop` 不在這個上限內。

## Reviewer evidence

Reviewer 派工由 orchestrator 負責，且為建議性質。Reviewer 會寫出 Markdown 報告；
沒有 hook 或 artifact 強制執行 review gate。

## 選用 extensions

其他 hook script 仍可供 consumer 明確設定，但不會因為啟用 module 或 userConfig
key 就自動註冊。需要它們的 consumer 必須自行註冊 hook command，並負責 runtime
成本、輸出與 failure policy。這包含 prompt hint、session/install health、Docker
probe、completion/graduation scan、SessionEnd 與 compaction、learning observation、
post-edit formatting/lint，以及 Stop reminder。

Module hook 仍可參與合併的 Bash dispatcher：active module 的 `pre-bash-*.sh` 與
`pre-commit-*.sh` 會收到 Bash payload；非零 exit status 會阻擋該 Bash 呼叫。這些
script 必須在不適用的 project/file context 自行 skip。

## Hook argument 展開

Claude Code plugin runtime 呼叫 hook 時，會在啟動 subprocess 前把該 hook entry
`args` 裡的 `${CLAUDE_PLUGIN_ROOT}` 展開成已安裝的 plugin root。這是觀察到的行為，
不是公開或保證的契約；請視為相容性指引，修改 hook argument 路徑前先對照已安裝的
runtime 重新確認。來源對應仍以 [`hooks/hooks.json`](../hooks/hooks.json) 為準。

## 將 assets 複製到 consumer project

`/dhpk:setup --install hooks|rules|scripts|all` 會呼叫
`scripts/setup/install-assets.sh`。hooks 與 scripts 複製到
`<project>/.claude/dhpk/{hooks,scripts}`。預設 `--install rules` 寫入
`<project>/.claude/rules/dhpk-overrides.md`，不會把 upstream policy 複製到
`.claude/dhpk/rules/`；`--vendor` 才會還原該不建議的 verbatim copy。既有的
`.claude/dhpk/rules/` 會被報告為 legacy，且不會刪除。Installer
不會修改 consumer hook settings。使用 `--dry-run` 查看完整 source/target plan；
不同內容的 target 是 conflict，只有明確加上 `--force` 才覆寫。Source 中可執行的
檔案會保留 executable bit。Installer 即使在 `--force` 下也拒絕 destination path
中的 symlink，包含 rules stub 路徑。
