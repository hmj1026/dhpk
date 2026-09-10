scope: release
note: Fix consumer/release probes misreading macOS's /var -> /private/var temp-directory alias as an unsafe symlink, which could falsely block Cursor/Codex consumer verification.
