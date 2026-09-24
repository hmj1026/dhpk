scope: bounded-test-runner
note: Pass --expand-environment=no to systemd-run in the bounded Linux test runner, because systemd 259 (Ubuntu 26.04) expands ${VAR} in scope arguments and blanked the inline cgroup check, failing every bounded run with "cgroup v2 path is unavailable".
