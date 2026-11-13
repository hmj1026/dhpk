scope: hooks
note: 修正 pre-bash-guard 對非遞迴深層系統路徑（如 `rm -f /usr/local/proj/x.log`）、`git commit` heredoc 訊息提及 `rm -rf /etc`，以及 `credential_shell` 對未加引號賦值命令替換 `x=$(cat <<'EOF'...)` 的誤判（#1407）。
