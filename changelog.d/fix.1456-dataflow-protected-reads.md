scope: hooks
note: 可見來源經位置參數、函式引數、`bash -c` 引數、命令替換、nameref／`${x@P}` 轉換、`read` here-string 欄位切分、`su -c`／`watch`／`$SHELL -c` 與帶 `-name` 篩選的 `find -exec`／`find | xargs` 進入 Reader 的受保護讀取改為阻擋；Git Gate 也擋下以替換運算子改寫的 git 命令字 (#1456)。
