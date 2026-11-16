scope: hooks
note: hooks、runtime 腳本與 Codex installer 一律從實體執行腳本所屬的套件解析根目錄，不再採用 CLAUDE_PLUGIN_ROOT（即使它指向另一份 dhpk）；installer 資料來源只由 DHPK_INSTALLER_ROOT 明確指定，新增 validate:plugin-root 擋下直接讀取該環境變數選根的寫法 (#1446)。
