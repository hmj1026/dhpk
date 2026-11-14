scope: hooks
note: 修正 Credential Guard 的文字範圍繞過 (#1411)：`${..}`／`$[..]` 巢狀不再被內嵌 `}`、`]` 提早關閉；fish、csh、tcsh、ash、mksh、busybox 讀 heredoc 視為程式碼；可能被執行的替換輸出（雙引號 `"$(...)"`、`x="$(...)"; $x`、`eval "$x"`）改以指令判讀 heredoc 文字；`cat $(echo .env)` 等動態檔名與 heredoc 餵給 `xargs` 一律封鎖。直譯器程式字串與寫入後執行維持範圍外 (ADR 0037)。
