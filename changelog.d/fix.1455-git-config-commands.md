scope: hooks
note: git 依設定或環境變數執行的命令（editor、`credential.helper`、`core.fsmonitor`、askpass、filter、`--upload-pack`、`ext::` 等）與 `GIT_CONFIG_COUNT`、`GIT_CONFIG_PARAMETERS`、`--config-env`、`env -S` 注入的值會遞迴判定受保護讀取 (#1455)。
