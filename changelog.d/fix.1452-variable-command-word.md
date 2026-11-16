scope: hooks
note: 同一指令中可見賦值且含 git 的變數（含 `+=`、`printf -v`、陣列、nameref、`${!x}`、大小寫轉換）被當命令字或 `shell -c` 內容時改為阻擋，唯讀值維持放行 (#1452)。
