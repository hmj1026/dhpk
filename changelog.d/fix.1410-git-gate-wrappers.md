scope: hooks
note: Git Gate 辨識 time、env、nice、sudo、timeout、xargs、exec、command -p 等 wrapper，並對 eval、source、cd -、CDPATH 與餵給 shell 的 here-string 採 fail-closed；叢集短選項（如 bash -oc）亦視為 -c 腳本 (#1410)。
