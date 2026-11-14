scope: hooks
note: pre-bash-dispatch、pre-bash-guard 與 pretool-git-gate 共用 command-inspect 解析快取，Pattern 2/3/6 改用解碼後結構，並修正 heredoc 標頭尾端 && / || 誤判為管線 (#1409)。
