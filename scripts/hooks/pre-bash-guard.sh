#!/usr/bin/env bash
# pre-bash-guard.sh — PreToolUse (Bash) hook
# Block dangerous bash patterns. Exit 2 rejects the call.
#
# Patterns:
#   1. rm -rf on root/system dirs (whitelist of known-dangerous top-level dirs)
#   2. Curl/wget piped to shell (typical supply-chain attack)
#   3. chmod 777/666 (almost always a mistake)
#   4. (retired) git push while review sentinels exist — the Review Sentinel
#      mechanism was retired (#376/#377); review-before-push is enforced
#      through reviewer dispatch, not a bash-level file check.
#   5. git commit/push with --no-verify
#   6. shell writes into .env files
#
# Project-extensible:
#   - Add patterns by editing this file or via a downstream hook.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/payload.sh"

PAYLOAD="$(dhpk_read_payload)"
CMD="$(extract_tool_input command "$PAYLOAD")"
[ -z "$CMD" ] && exit 0

# Strip shell comments before matching — avoids false-positives on text after `#`.
CMD_STRIPPED="$(printf '%s' "$CMD" | sed 's/[[:space:]]*#.*//')"

# Pattern 1: rm -rf on root or sensitive top-level dirs.
# Whitelist approach: only block known-dangerous targets to avoid false-positives
# on /tmp, /var/tmp, /var/log cleanups.
#
# Two tiers (D4, harvest-advice-20260711):
#   - DANGEROUS_ROOT_ANY: system dirs, blocked at any depth (rm -rf /etc/nginx/conf.d
#     stays blocked — these never legitimately need recursive deletion under Claude).
#   - DANGEROUS_ROOT_SHALLOW: user-data dirs (home/opt/srv), blocked only at depth <=2
#     (/home, /home/, /home/<seg>, /home/<seg>/) so whole-home deletion stays blocked
#     while workspace-internal paths (/home/<user>/projects/<repo>/...) pass.
DANGEROUS_ROOT_ANY='(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev|run|root|snap)'
DANGEROUS_ROOT_SHALLOW="(home|opt|srv)(/+[^/[:space:]]+)?/*[\"']?([[:space:];&|]|$)"
if printf '%s' "$CMD_STRIPPED" | grep -Eq \
    "(^|[[:space:];&|])rm[[:space:]]+(-[a-zA-Z]+[[:space:]]+)+(--[[:space:]]+)?[\"']?/+([[:space:]\$\*]|$|${DANGEROUS_ROOT_ANY}([/[:space:]]|[\"']?([[:space:];&|]|$))|${DANGEROUS_ROOT_SHALLOW})"; then
    echo "[bash-guard] blocked: rm -rf against root or system directory. Narrow the path or run outside Claude." >&2
    exit 2
fi

# Pattern 2: curl|sh / wget|bash / fetch|zsh family.
if printf '%s' "$CMD_STRIPPED" | grep -Eq '(curl|wget|fetch)[^|]*\|[[:space:]]*(sh|bash|zsh|ksh)([[:space:]]|$|;|\|)'; then
    echo "[bash-guard] blocked: piping remote download into shell. Save to file, inspect, then run." >&2
    exit 2
fi

# Pattern 3: chmod 777 / 666 (including -R777 etc).
if printf '%s' "$CMD_STRIPPED" | grep -Eq '(^|[[:space:];&|])chmod[[:space:]]+(-[a-zA-Z]*[[:space:]]*)?[0-7]?(777|666)([[:space:]]|$)'; then
    echo "[bash-guard] blocked: chmod 777/666. Use stricter perms (750/640) or narrower paths." >&2
    exit 2
fi

# Pattern 5: git commit / push with --no-verify — bypasses the pre-commit /
# pre-push hook gates (lint, type-check, test baseline, etc.) the harness and
# projects install. Block the explicit long form (unambiguous for both commit
# and push; short `-n` is overloaded — push's `-n` means --dry-run — so it is
# intentionally NOT matched). Fix the failing gate instead of skipping it.
# Opt out for a session: DHPK_ALLOW_NO_VERIFY=1
# Strip quoted runs (commit messages, etc.) before matching the flag — a real
# `--no-verify` flag is never inside quotes, so this avoids false-positives like
# `git commit -m "do not skip --no-verify"`.
CMD_FLAGS="$(printf '%s' "$CMD_STRIPPED" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")"
if [ "${DHPK_ALLOW_NO_VERIFY:-0}" = "0" ] && \
   printf '%s' "$CMD_FLAGS" | grep -Eq '(^|[[:space:]])git[[:space:]]+(commit|push)([[:space:]]|$)' && \
   printf '%s' "$CMD_FLAGS" | grep -Eq '(^|[[:space:]])--no-verify([[:space:]]|=|$)'; then
    echo "[bash-guard] blocked: '--no-verify' bypasses the pre-commit/pre-push gates. Fix the failing check; if you must bypass, set DHPK_ALLOW_NO_VERIFY=1 or run outside Claude." >&2
    exit 2
fi

# Pattern 6: shell writes into .env files (redirection / tee) — closes the
# bypass where a blocked Write/Edit against .env is retried via Bash
# (D6, harvest-advice-20260711). Mirrors pre-edit-guard.sh's allowlist:
# .env.example / .env.sample / .env.dist are version-controlled templates
# carrying no secrets and remain writable.
#
# Target-scoped allowlisting (fix, harvest-advice-20260711 fix round): the
# allowlist must only exempt commands whose write TARGET is an allowlisted
# file, not any command that merely mentions an allowlisted filename anywhere
# in its text — otherwise `echo SECRET=x > .env ; cat .env.example` bypasses
# the block because the whole-command grep sees `.env.example` and skips.
# Strip allowlisted redirection/tee targets from a copy of the command first,
# then test what remains for a real `.env` write.
#
# Path-prefix tolerance (fix round 2, harvest-advice-20260711): the redirect
# target may carry a directory prefix (`api/.env`, `./.env`, `/tmp/foo/.env`,
# `../.env`) — match an optional leading path segment before `.env` in both
# the allowlist-strip patterns and the block patterns below, so `> .env` and
# `> some/dir/.env` are treated identically.
_env_cmd="$(printf '%s' "$CMD_STRIPPED" | sed -E \
    -e "s/(>>?)[[:space:]]*[\"']?([^[:space:];&|]*\/)?\.env\.(example|sample|dist)[\"']?([[:space:];&|]|\$)/ /g" \
    -e "s/(^|[[:space:];&|])tee[[:space:]]+(-a[[:space:]]+)?[\"']?([^[:space:];&|]*\/)?\.env\.(example|sample|dist)[\"']?([[:space:];&|]|\$)/\1 /g")"
if printf '%s' "$_env_cmd" | grep -Eq "(>>?)[[:space:]]*[\"']?([^[:space:];&|]*/)?\.env(\.[A-Za-z0-9_.-]+)?[\"']?([[:space:];&|]|\$)" || \
   printf '%s' "$_env_cmd" | grep -Eq "(^|[[:space:];&|])tee[[:space:]]+(-a[[:space:]]+)?[\"']?([^[:space:];&|]*/)?\.env(\.[A-Za-z0-9_.-]+)?[\"']?([[:space:];&|]|\$)"; then
    echo "[bash-guard] blocked: writing to .env via shell redirection/tee. .env files hold secrets and must not be written via Bash. Ask the user for the value, or use .env.example as a template." >&2
    exit 2
fi

exit 0
