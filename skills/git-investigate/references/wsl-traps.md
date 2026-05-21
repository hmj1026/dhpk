# WSL git operation traps (<your-project>)

## Trap 1：root 擁有的 untracked 同名檔擋 git merge / checkout

**症狀**：`git merge develop --ff-only` 中途丟出 `error: unable to unlink old '<path>': 拒絕不符權限的操作` 並停下，但 HEAD 不前進、`git status` 顯示一大堆 D/M 改動。看起來像「push 推不上去」（`git push --dry-run` 顯示 `Everything up-to-date`），實際上是 merge 根本沒成功套上。

### 根因

本地 docker / cron 服務以 root 跑（例如 `${PHP_CONTAINER:-php}` 容器寫 `protected/data/twd97-geocode.php`、weather cron 寫 `protected/runtime/weather/*`），在工作樹留下 `root:root` 擁有的 untracked 檔；當 develop 把「同路徑」加入追蹤後，FF 要先 unlink 該檔，但 `$USER` 對 root 擁有的父目錄沒有寫權限 → unlink 失敗 → merge 中途停擺、working tree 半套。

blast radius 看起來像 push/權限/網路，會把人帶歪。reflog 也不會留下「失敗 merge」的紀錄，只看到 checkout，更加誤導。

### 修法

```bash
# 1. 先盤點 root 擁有目錄
find . -path ./.git -prune -o -uid 0 -type d -print 2>/dev/null

# 2. 交叉 git diff 找真正阻擋的子集（通常只有 1-2 個目錄）
git diff --name-only main..<target> | head

# 3. 修最小範圍 — 不要全 repo chown，否則 docker / cron 之後又會卡
sudo chown -R "$USER:$USER" <blocking-dir>

# 4. 清半套狀態：救回被 git 刪掉的 tracked 檔、移除 git 半路創出的 untracked 檔
git restore --source=HEAD --staged --worktree .

# 5. 再 clean 剩餘 git 創出未追蹤檔（.gitignore 內容自動跳過）
git clean -fd

# 6. 重試 FF
git merge <branch> --ff-only
```

### 預防

- `protected/data/`、`protected/runtime/`、`build/`、`protected/tests/coverage/` 這幾個常被 docker/cron 以 root 寫入的目錄，凡是「develop 有把新檔追蹤進去」就要先確認本地是否 root-owned
- 若 docker compose 設定可以指定 `user:`，把容器 UID 對齊 `$USER` 是長期解
- 失敗訊息含 `unable to unlink old` + 「拒絕不符權限的操作」就是這個坑

> Trap dated 2026-05-15. Parent commit range `968de06c..a4b40022` 是觸發本 trap 的 merge。

## Trap 2：git-smart-commit 全 staged 失效

`git add` 特定檔案後 commit 仍會帶走全部 staged 檔案，導致 commit 邊界錯亂。

### 處置

- 先 `git status --short` 確認狀態
- 若全 staged → 不用 `/git-smart-commit`，直接手動拆分（提供 commit 文本給 user）
- 若需拆分 → 先 `git restore --staged <files>` 反暫存不屬於該 commit 的檔案
