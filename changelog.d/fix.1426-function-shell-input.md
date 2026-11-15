scope: hooks
note: 函式呼叫（含 function、 -s、子殼裡的呼叫與 >(f)）、管線、巢狀子殼、{ } 與 if、while、for、case、行程替換與寫入 >(shell) 餵給 shell 或 `.` 的輸入，看得見的 git 不再放行；子殼與 `&&` 裡的重定義不會改掉外面仍會執行的函式，看不見的命令字維持未解析。stdin 裝置也算腳本。同一段文字餵給 cat 仍是資料 (#1426)。
