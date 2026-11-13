scope: hooks
note: 將 `command-inspect.sh` 與 `credential_shell.py` 對大量相鄰命令替換與多次 heredoc 的掃描改為線性時間，3000 個相鄰替換由約 39 秒降至 2 秒內完成（#1408）。
