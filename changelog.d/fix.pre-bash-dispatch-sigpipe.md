scope: hooks
note: Fix pre-bash-dispatch.sh exiting 141 (SIGPIPE) instead of continuing when a guard or module hook exits 0 without reading its stdin payload (#1351).
