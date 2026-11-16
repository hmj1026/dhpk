scope: hooks
note: CLAUDE_PLUGIN_ROOT 指向別的 plugin 時，session-start、session-end、pre-bash-dispatch、stop 與 UserPromptSubmit 等 hook 改用腳本自己的根目錄，不再因找不到 `_lib/session-env.sh` 而報錯。
