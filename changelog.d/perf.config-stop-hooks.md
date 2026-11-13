scope: hooks
note: Speed up the config and Stop hooks with no behavior change: CSV and module-list trimming now runs in pure bash with globbing disabled, the Stop advisory dispatch parses the project config once instead of three times, and SubagentStop verification merges its jq, python3 and date calls while keeping the no-jq fallback (#1382).
