# Hook extension model

> **語言**：[English](./hook-extension.md) · **繁體中文**

dhpk 刻意只註冊精簡的預設 lifecycle。完整 mapping 以
[`hooks/hooks.json`](../hooks/hooks.json) 為準：

| Event | Script | 確定性責任 |
|---|---|---|
| `PreToolUse(Edit\|Write\|MultiEdit)` | `pre-edit-guard.sh` | 受保護路徑與 secret safety |
| `PreToolUse(Bash)` | `pre-bash-dispatch.sh` | shell safety 加 Git branch-safety gate |
| `SessionStart` | `session-start.sh` | 驗證並啟用設定的 module |
| `SubagentStop` | `subagent-stop-verify.sh` | 清理已停止 fast-worker 的 liveness state |

`session-start.sh` 只啟用 module；
不建立 snapshot、不探測 Docker、不檢查安裝健康、不注入 prompt hint，也不輸出
orchestration 建議。

## Reviewer evidence

Reviewer 派工由 orchestrator 負責。Reviewer 會記錄具有 identity binding 的
Review Gate result；缺失、格式錯誤、warning 或 failure 都會讓 obligation 保持 unresolved。

## 選用 extensions

其他 hook script 仍可供 consumer 明確設定，但不會因為啟用 module 或 userConfig
key 就自動註冊。需要它們的 consumer 必須自行註冊 hook command，並負責 runtime
成本、輸出與 failure policy。這包含 prompt hint、session/install health、Docker
probe、completion/graduation scan、SessionEnd 與 compaction、learning observation、
post-edit formatting/lint，以及 Stop reminder。

Module hook 仍可參與合併的 Bash dispatcher：active module 的 `pre-bash-*.sh` 與
`pre-commit-*.sh` 會收到 Bash payload；非零 exit status 會阻擋該 Bash 呼叫。這些
script 必須在不適用的 project/file context 自行 skip。

## 將 assets 複製到 consumer project

`/dhpk:setup --install hooks|rules|scripts|all` 會呼叫
`scripts/setup/install-assets.sh`，把選定 source asset 複製到
`<project>/.claude/dhpk/{hooks,rules,scripts}`，但不會修改 consumer hook settings。
使用 `--dry-run` 查看完整 source/target plan；不同內容的 target 是 conflict，只有
明確加上 `--force` 才覆寫。Source 中可執行的檔案會保留 executable bit。Installer
即使在 `--force` 下也拒絕 destination path 中的 symlink，避免寫出
`<project>/.claude/dhpk`。
