#!/usr/bin/env bash
# pretool-git-gate.sh — PreToolUse (Bash) hook
#
# Merges pretool-sentinel-gate.sh + pretool-branch-safety.sh into one script
# that parses the Bash tool payload once and evaluates two independent
# warn-only checks against the shared parsed command:
#
#   sentinel-commit slot — warns (or optionally blocks) on `git commit` /
#     `git merge` / `git rebase` / `git cherry-pick` while reviewer sentinels
#     are still pending. Mode: DHPK_SENTINEL_COMMIT_GATE (warn|block|off).
#
#   protected-branch slot — warns (or optionally blocks) on `git commit` /
#     `git merge` / `git rebase` / `git cherry-pick` / `git reset` / `git push`
#     while on a protected branch (main / master / develop / release/* / ...).
#     Mode: DHPK_BRANCH_SAFETY (warn|block|off).
#
# The two verb families intentionally differ (branch-safety additionally
# gates reset/push) — this is preserved, not unified.
#
# Companion to pre-bash-guard.sh (hard-block surface for rm -rf / curl|sh /
# chmod 777 / git push --force). This script's warn-only paths are kept
# separate from that stable hard-block surface by design.
#
# Resolution:
#   - If either slot fires in block mode: one combined stderr message naming
#     every fired slot, exit 2 (never deduped).
#   - Else if any slot fires in warn mode: one combined systemMessage
#     covering every fired warn slot, exit 0.
#   - Else: silent exit 0.
#
# Trigger: PreToolUse Bash matcher. Cost: two regex passes + one
# `git branch --show-current` + array iteration, <30ms. timeout: 5.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/json-out.sh"

# Mode resolution: env override (DHPK_*) wins for one-shot toggles; otherwise
# read from userConfig via load-project-config.sh-populated env. Independence
# is load-bearing — one may be set without the other.
SENTINEL_MODE="$(dhpk_config_get sentinel_commit_gate warn DHPK_SENTINEL_COMMIT_GATE)"
BRANCH_MODE="$(dhpk_config_get branch_safety warn DHPK_BRANCH_SAFETY)"

# If both are off, nothing to do — skip the parse entirely.
if [ "$SENTINEL_MODE" = "off" ] && [ "$BRANCH_MODE" = "off" ]; then
    exit 0
fi

PAYLOAD="$(dhpk_read_payload)"
CMD="$(extract_tool_input command "$PAYLOAD")"
[ -z "$CMD" ] && exit 0

# Strip shell comments once to avoid matching text after `#`.
CMD_STRIPPED="$(printf '%s' "$CMD" | sed 's/[[:space:]]*#.*//')"

# Slot state: fired flags, modes, and detail strings.
SENTINEL_FIRED=0
SENTINEL_DETAIL=""
BRANCH_FIRED=0
BRANCH_DETAIL=""

# ---------------------------------------------------------------------------
# sentinel-commit slot — ported unchanged from pretool-sentinel-gate.sh
# ---------------------------------------------------------------------------
if [ "$SENTINEL_MODE" != "off" ]; then
    if printf '%s' "$CMD_STRIPPED" | grep -Eq \
        '(^|[[:space:]])git[[:space:]]+(commit|merge|rebase|cherry-pick)([[:space:]]|$)' \
        && ! printf '%s' "$CMD_STRIPPED" | grep -Eq \
        '(--help|[[:space:]]-h([[:space:]]|$)|--dry-run|--abort|--continue|--skip|--quit)'; then

        ROOT="$(dhpk_root)"
        SESS="$(dhpk_sessions_dir "$ROOT")"

        active_names=()
        active_agents=()
        for i in "${!SENTINEL_NAMES[@]}"; do
            f="$SESS/${SENTINEL_NAMES[$i]}"
            if [ -f "$f" ]; then
                active_names+=("${SENTINEL_NAMES[$i]}")
                active_agents+=("${SENTINEL_AGENTS[$i]}")
            fi
        done

        if [ "${#active_names[@]}" -gt 0 ]; then
            verb="$(printf '%s' "$CMD_STRIPPED" | grep -oE 'git[[:space:]]+(commit|merge|rebase|cherry-pick)' | head -1 | tr -s ' ' | sed 's/^git //')"
            [ -z "$verb" ] && verb="git op"
            names_csv="$(IFS=,; printf '%s' "${active_names[*]}")"
            agents_csv="$(IFS=,; printf '%s' "${active_agents[*]}")"

            SENTINEL_FIRED=1
            SENTINEL_DETAIL="REMINDER: $verb attempted while reviewer chain is pending.
Active sentinels: $names_csv
Pending reviewers: $agents_csv
Run each reviewer first, or bypass by setting DHPK_SENTINEL_COMMIT_GATE=off"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# protected-branch slot — ported unchanged from pretool-branch-safety.sh
# ---------------------------------------------------------------------------
if [ "$BRANCH_MODE" != "off" ]; then
    if printf '%s' "$CMD_STRIPPED" | grep -Eq \
        '(^|[[:space:]])git[[:space:]]+(commit|merge|rebase|cherry-pick|reset|push)([[:space:]]|$)' \
        && ! printf '%s' "$CMD_STRIPPED" | grep -Eq \
        '(--help|[[:space:]]-h([[:space:]]|$)|--dry-run|--abort|--continue|--skip|--quit)'; then

        ROOT="$(dhpk_root)"
        BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '')"

        if [ -n "$BRANCH" ]; then
            # Default protected list. Override via userConfig.protected_branches.
            PROTECTED_RAW="$(dhpk_config_csv protected_branches 'main,master,develop,release/*,hotfix/*')"

            matched=0
            IFS=',' read -r -a _branches <<< "$PROTECTED_RAW"
            for pat in "${_branches[@]}"; do
                pat="$(echo "$pat" | xargs)"
                [ -z "$pat" ] && continue
                # shellcheck disable=SC2053  # intentional glob match, not equality
                case "$BRANCH" in
                    $pat) matched=1; break ;;
                esac
            done

            if [ "$matched" -eq 1 ]; then
                verb="$(printf '%s' "$CMD_STRIPPED" | grep -oE 'git[[:space:]]+(commit|merge|rebase|cherry-pick|reset|push)' | head -1 | tr -s ' ' | sed 's/^git //')"

                DETAIL="REMINDER: $verb on protected branch '$BRANCH'.
Protected list: $PROTECTED_RAW
Suggested: create a feature branch first (\`git checkout -b feat/...\`)
Override: DHPK_BRANCH_SAFETY=off (one-off) or set userConfig.protected_branches"

                if [ "$BRANCH_MODE" = "block" ]; then
                    BRANCH_FIRED=1
                    BRANCH_DETAIL="$DETAIL"
                else
                    # warn mode: dedup via per-session state file (unchanged
                    # from pretool-branch-safety.sh). block mode is never
                    # deduped — a rejected command must always explain itself.
                    SESSION_ID="$(extract_top_field session_id "$PAYLOAD")"
                    SESSION_ID="${SESSION_ID//[^A-Za-z0-9_-]/_}"
                    _bs_skip=0
                    if [ -n "$SESSION_ID" ]; then
                        _bs_state="${TMPDIR:-/tmp}/dhpk-branch-safety-${SESSION_ID}.state"
                        _bs_key="$(printf '%s' "$PROTECTED_RAW" | cksum | cut -d' ' -f1)"
                        _bs_line="$(printf '%s\t%s' "$BRANCH" "$_bs_key")"
                        if [ -f "$_bs_state" ] && grep -Fxq -- "$_bs_line" "$_bs_state" 2>/dev/null; then
                            _bs_skip=1   # already warned for this branch+config this session
                        else
                            printf '%s\n' "$_bs_line" >> "$_bs_state" 2>/dev/null || true
                        fi
                    fi
                    if [ "$_bs_skip" -eq 0 ]; then
                        BRANCH_FIRED=1
                        BRANCH_DETAIL="$DETAIL"
                    fi
                fi
            fi
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Combined resolution — respects the one-JSON-object-per-invocation constraint
# ---------------------------------------------------------------------------
BLOCK_MSG=""
if [ "$SENTINEL_FIRED" -eq 1 ] && [ "$SENTINEL_MODE" = "block" ]; then
    BLOCK_MSG="${BLOCK_MSG}✗  BLOCKED [sentinel-gate]: ${SENTINEL_DETAIL}
"
fi
if [ "$BRANCH_FIRED" -eq 1 ] && [ "$BRANCH_MODE" = "block" ]; then
    BLOCK_MSG="${BLOCK_MSG}✗  BLOCKED [branch-safety]: ${BRANCH_DETAIL}
"
fi

if [ -n "$BLOCK_MSG" ]; then
    # A slot firing in warn mode alongside a block-mode slot must still
    # surface its detail in this single combined stderr block (spec:
    # design.md Decision (a) step 5) — labeled distinctly from BLOCKED so
    # it reads as a reminder, not a second block.
    if [ "$SENTINEL_FIRED" -eq 1 ] && [ "$SENTINEL_MODE" = "warn" ]; then
        BLOCK_MSG="${BLOCK_MSG}⚠  reminder [sentinel-gate]: ${SENTINEL_DETAIL}
"
    fi
    if [ "$BRANCH_FIRED" -eq 1 ] && [ "$BRANCH_MODE" = "warn" ]; then
        BLOCK_MSG="${BLOCK_MSG}⚠  reminder [branch-safety]: ${BRANCH_DETAIL}
"
    fi

    # exit 2 + stderr is the documented PreToolUse block path (stderr → Claude).
    {
        echo ""
        echo "-----------------------------------------------------------"
        printf '%s' "$BLOCK_MSG" | sed 's/^/   /'
        echo "-----------------------------------------------------------"
    } >&2
    exit 2
fi

WARN_MSG=""
if [ "$SENTINEL_FIRED" -eq 1 ] && [ "$SENTINEL_MODE" = "warn" ]; then
    WARN_MSG="${WARN_MSG}[sentinel-gate] ${SENTINEL_DETAIL}
"
fi
if [ "$BRANCH_FIRED" -eq 1 ] && [ "$BRANCH_MODE" = "warn" ]; then
    WARN_MSG="${WARN_MSG}[branch-safety] ${BRANCH_DETAIL}
"
fi

if [ -n "$WARN_MSG" ]; then
    emit_system_message "$WARN_MSG"
fi

exit 0
