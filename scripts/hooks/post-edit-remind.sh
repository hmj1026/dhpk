#!/usr/bin/env bash
# post-edit-remind.sh — PostToolUse (Edit|Write|MultiEdit) hook
#
# Writes review sentinels based on:
#   1. Built-in file-extension defaults (language-agnostic)
#   2. Active modules' triggers (modules/<name>/module.yaml, set by session-start)
#   3. userConfig.review_trigger_extra_paths (slot-prefixed: code:, db:, sec:, fe:, doc:, mig:)
#
# Sentinels live at $ROOT/.claude/artifacts/sessions/.pending-{review,db-review,security-review,frontend-review,doc-review,polyfill-review,migration-review}
# and are cleared by each review agent's Closing hook via clear-sentinel.sh.
#
# Self-edits to .claude/artifacts/** are skipped (review agents writing their
# own reports would otherwise re-trigger themselves).

set -o pipefail

. "$(dirname "$0")/_lib/payload.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PAYLOAD="$(cat 2>/dev/null || true)"
FILE_PATH="$(extract_tool_input file_path "$PAYLOAD")"
# Some tool payload variants carry camelCase keys — fall back before giving up.
[ -z "$FILE_PATH" ] && FILE_PATH="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE_PATH" ] && exit 0

REL="${FILE_PATH#$ROOT/}"
BASENAME="${REL##*/}"

case "$REL" in
    .claude/artifacts/*) exit 0 ;;
esac

ARTIFACTS="$ROOT/.claude/artifacts/sessions"
mkdir -p "$ARTIFACTS"

# Slot 0=code, 1=db, 2=sec, 3=frontend, 4=doc, 5=polyfill, 6=migration
# (matches SENTINEL_NAMES order). Slots 5 and 6 have no built-in defaults:
# polyfill is written by the library-author module hook; migration is opt-in
# via module.yaml `migration:` triggers or review_trigger_extra_paths `mig:`.
NEEDS=(0 0 0 0 0 0 0)

# ---- Built-in file-extension defaults (always on) ----

# code-reviewer (slot 0): common source-code extensions. Harness config artifacts
# (.sh/.json/.yml/.yaml) also routed here. Doc files (.md) go to slot 4.
case "$BASENAME" in
    *.php|*.js|*.ts|*.tsx|*.jsx|*.mjs|*.cjs|*.vue|*.svelte|*.py|*.rb|*.go|*.rs|*.java|*.kt|*.swift|*.cs|*.c|*.cpp|*.h|*.hpp)
        NEEDS[0]=1 ;;
esac
case "$REL" in
    .claude/agents/*|.claude/rules/*|.claude/commands/*|.claude/hooks/*|.claude/scripts/*|.claude/skills/*|.claude/manifests/*)
        case "$BASENAME" in *.sh|*.json|*.yml|*.yaml) NEEDS[0]=1 ;; esac ;;
esac

# database-reviewer (slot 1): SQL + generic migrations
case "$BASENAME" in
    *.sql) NEEDS[1]=1 ;;
esac
case "$REL" in
    *migrations/*|*migration/*)
        case "$BASENAME" in *.php|*.py|*.rb|*.ts|*.js|*.sql) NEEDS[1]=1 ;; esac ;;
esac

# security-reviewer (slot 2): authn/authz/upload/file keyword in basename
case "$BASENAME" in
    *Auth*|*auth*|*Login*|*login*|*Acl*|*acl*|*Upload*|*upload*|*File*|*file*)
        # Restrict to source-code extensions to avoid noise on auth.md / login.html.
        case "$BASENAME" in *.php|*.js|*.ts|*.tsx|*.jsx|*.py|*.rb|*.go|*.rs|*.java) NEEDS[2]=1 ;; esac ;;
esac

# frontend-reviewer (slot 3): no built-in default routing — opt in via JS (or
# other frontend) module.yaml triggers, or via review_trigger_extra_paths fe:.
# Rationale: code-reviewer (slot 0) already catches JS/TS for general correctness;
# slot 3 adds JS-specific checks (lint config, SSOT facade) only when the
# project has opted in.

# doc-reviewer (slot 4): structural / policy docs. Restricted to harness +
# OpenSpec + repo-level docs/ + top-level CLAUDE.md / AGENTS.md / README*.md
# to avoid firing on every blog post or vendored doc.
case "$REL" in
    .claude/agents/*|.claude/rules/*|.claude/commands/*|.claude/hooks/*|.claude/scripts/*|.claude/skills/*|.claude/manifests/*|openspec/*|docs/*)
        case "$BASENAME" in *.md) NEEDS[4]=1 ;; esac ;;
esac
case "$BASENAME" in
    CLAUDE.md|AGENTS.md) NEEDS[4]=1 ;;
esac
# Top-level README only (skip nested vendored READMEs).
case "$REL" in
    README*.md) [[ "$REL" != */* ]] && NEEDS[4]=1 ;;
esac


# ---- Active-module triggers ----
# DHPK_ACTIVE_MODULES is set by session-start.sh (csv of module names).
# Each module's module.yaml triggers contribute extra extensions and paths per slot.

_dhpk_check_module_triggers() {
    local module_name="$1" module_root="$2"
    [ -f "$module_root/module.yaml" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0
    # Emit `slot=<0|1|2> kind=<ext|path> value=<v>` lines.
    python3 - "$module_root/module.yaml" "$REL" "$BASENAME" <<'PY' 2>/dev/null
import sys, os, re
def parse_yaml(text):
    # Minimal YAML parser for our flat module.yaml structure:
    #   triggers:
    #     code:
    #       extensions: [".php"]
    #       paths: [protected/, infrastructure/]
    out = {}
    stack = [(0, out)]
    cur_key = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        while stack and indent < stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        s = line.strip()
        if ":" in s:
            k, _, v = s.partition(":")
            k = k.strip(); v = v.strip()
            if v == "":
                d = {}
                parent[k] = d
                stack.append((indent + 2, d))
            elif v.startswith("[") and v.endswith("]"):
                inner = v[1:-1].strip()
                items = [x.strip().strip('"').strip("'") for x in inner.split(",") if x.strip()] if inner else []
                parent[k] = items
            else:
                parent[k] = v.strip('"').strip("'")
    return out

path = sys.argv[1]; rel = sys.argv[2]; basename = sys.argv[3]
try:
    with open(path) as f:
        cfg = parse_yaml(f.read())
except Exception:
    sys.exit(0)
triggers = cfg.get("triggers") or {}
# Aliases: "fe" → 3, "frontend" → 3; "doc" → 4; "mig" → 6, "migration" → 6
slot_map = {"code": 0, "db": 1, "sec": 2, "frontend": 3, "fe": 3, "doc": 4, "polyfill": 5, "mig": 6, "migration": 6}
for slot_name, slot_idx in slot_map.items():
    block = triggers.get(slot_name) or {}
    for ext in (block.get("extensions") or []):
        if basename.endswith(ext):
            print(f"{slot_idx}")
            break
    for path_prefix in (block.get("paths") or []):
        if rel.startswith(path_prefix):
            print(f"{slot_idx}")
            break
PY
}

if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    if ! command -v python3 >/dev/null 2>&1; then
        echo "[post-edit] WARN: modules enabled (${DHPK_ACTIVE_MODULES}) but python3 missing — module triggers disabled. Install python3 to enable per-module path triggers." >&2
    else
        PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
        IFS=',' read -r -a _mods <<< "$DHPK_ACTIVE_MODULES"
        for _m in "${_mods[@]}"; do
            _m="$(echo "$_m" | xargs)"  # trim
            [ -z "$_m" ] && continue
            _mdir="$PLUGIN_ROOT/modules/$_m"
            [ -d "$_mdir" ] || continue
            while IFS= read -r _slot; do
                [ -n "$_slot" ] && NEEDS[$_slot]=1
            done < <(_dhpk_check_module_triggers "$_m" "$_mdir")
        done
    fi
fi

# ---- User-supplied extra paths (CLAUDE_PLUGIN_OPTION_REVIEW_TRIGGER_EXTRA_PATHS) ----
# Entries shaped `<slot>:<prefix>` where slot ∈ code|db|sec|fe|doc|mig|art.
if [ -n "${CLAUDE_PLUGIN_OPTION_REVIEW_TRIGGER_EXTRA_PATHS:-}" ]; then
    IFS=',' read -r -a _extras <<< "${CLAUDE_PLUGIN_OPTION_REVIEW_TRIGGER_EXTRA_PATHS}"
    for _e in "${_extras[@]}"; do
        _e="$(echo "$_e" | xargs)"
        case "$_e" in
            code:*) [[ "$REL" == "${_e#code:}"* ]] && NEEDS[0]=1 ;;
            db:*)   [[ "$REL" == "${_e#db:}"* ]] && NEEDS[1]=1 ;;
            sec:*)  [[ "$REL" == "${_e#sec:}"* ]] && NEEDS[2]=1 ;;
            fe:*)   [[ "$REL" == "${_e#fe:}"* ]] && NEEDS[3]=1 ;;
            doc:*)  [[ "$REL" == "${_e#doc:}"* ]] && NEEDS[4]=1 ;;
            mig:*)  [[ "$REL" == "${_e#mig:}"* ]] && NEEDS[6]=1 ;;
        esac
    done
fi

# ---- Triage: drop mechanically-trivial false-positive sentinels ----
# The AI-orchestration triage (execution-policy) makes the judgment calls with
# full diff visibility; this hook-level pass drops sentinels only for the two
# change classes that are *mechanically* safe to detect at write time:
# comment-only edits (drops db/sec/fe/poly/mig; KEEPS code + doc) and small
# pure-style CSS tweaks (net<=8; drops db/sec/fe; keeps code). Whitespace /
# reformatting is intentionally NOT handled here — no git whitespace flag can
# tell inert reindentation from a meaningful string-literal whitespace change
# (e.g. explode('  ') -> explode(' ')), so that judgment is left to the
# orchestration triage. Anything ambiguous (new file, binary, untracked, any
# git uncertainty) KEEPS every sentinel — a missed review is worse than an
# extra one. Diff is measured cumulatively vs HEAD, so a file that grows
# substantial across edits re-acquires its sentinel.
_tri_drop() {  # $1=slot $2=reason — clear NEEDS + remove any pending line for $REL
    local _s="$1"
    [ "${NEEDS[$_s]:-0}" -eq 1 ] || return 0
    NEEDS[$_s]=0
    local _sf="$ARTIFACTS/${SENTINEL_NAMES[$_s]}" _keep
    if [ -f "$_sf" ]; then
        _keep="$(REL_FOR_AWK="$REL" awk 'BEGIN{p=ENVIRON["REL_FOR_AWK"]} { n=$0; sub(/^[^ ]+ [^ ]+ /,"",n); if (n != p) print $0 }' "$_sf" 2>/dev/null)"
        if [ -n "$_keep" ]; then printf '%s\n' "$_keep" > "$_sf"; else rm -f "$_sf"; fi
    fi
    echo "[post-edit] triage-drop ${SENTINEL_SHORT_NAMES[$_s]} ($REL): $2"
}
_tri_comment_only() {  # 0 iff >=1 changed line seen and every changed non-blank line is a comment in this file's language
    local _body _ln _t _seen=0 _ext
    _ext="$(printf '%s' "${BASENAME##*.}" | tr '[:upper:]' '[:lower:]')"
    _body="$(git -C "$ROOT" diff HEAD -U0 -- "$REL" 2>/dev/null)" || return 1
    [ -n "$_body" ] || return 1
    while IFS= read -r _ln; do
        case "$_ln" in
            +++*|---*) continue ;;
            +*|-*) _t="${_ln:1}" ;;
            *) continue ;;
        esac
        _t="${_t#"${_t%%[![:space:]]*}"}"   # ltrim
        [ -z "$_t" ] && continue
        _seen=1
        # Unambiguous C-family / markup comment markers (safe at line start in any language).
        case "$_t" in
            '//'*|'/*'*|'* '*|'*/'*|'<!--'*|'-->'*) continue ;;
        esac
        # '#': comment in shell/python/ruby/yaml/php, but id-selector / hex colour in CSS.
        case "$_ext" in
            css|scss|sass|less) ;;
            *) case "$_t" in '#'*) continue ;; esac ;;
        esac
        # '--': line comment only in SQL/Lua, and only as '-- ' or bare '--'
        # (NOT '--$var' pre-decrement, NOT '--custom-prop' CSS custom property).
        case "$_ext" in
            sql|lua) case "$_t" in '-- '*|'--') continue ;; esac ;;
        esac
        return 1   # a non-comment content line → not comment-only
    done <<< "$_body"
    [ "$_seen" -eq 1 ]
}
_tri_numstat="$(git -C "$ROOT" diff HEAD --numstat -- "$REL" 2>/dev/null | awk 'NR==1{print $1" "$2}')"
_tri_add="${_tri_numstat%% *}"; _tri_rem="${_tri_numstat##* }"
if [ -n "$_tri_numstat" ] && [ "$_tri_add" != "-" ] && [ "$_tri_rem" != "-" ] \
   && printf '%s' "$_tri_add$_tri_rem" | grep -qE '^[0-9]+$'; then
    _tri_net=$(( _tri_add + _tri_rem ))
    _tri_ext="$(printf '%s' "${BASENAME##*.}" | tr '[:upper:]' '[:lower:]')"
    if _tri_comment_only; then
        for _tri_s in 1 2 3 5 6; do _tri_drop "$_tri_s" "comment-only edit"; done
    elif [ "$_tri_net" -le 8 ]; then
        case "$_tri_ext" in
            css|scss|sass|less) for _tri_s in 1 2 3; do _tri_drop "$_tri_s" "pure-style CSS (net=$_tri_net)"; done ;;
        esac
    fi
fi

# ---- Write sentinels ----
# Idempotent append: if $REL already appears in the sentinel (any timestamp),
# skip the write. Stops repeated edits to the same file from accumulating
# duplicate lines that mislead reviewers and stop-review-reminder's `wc -l`.
msg=""
for i in "${!NEEDS[@]}"; do
    if [ "${NEEDS[$i]}" -eq 1 ]; then
        sentinel="$ARTIFACTS/${SENTINEL_NAMES[$i]}"
        # cut -d' ' -f3- drops the "YYYY-MM-DD HH:MM:SS " timestamp prefix,
        # leaving only the path part for an exact-line compare against $REL.
        if [ -f "$sentinel" ] && cut -d' ' -f3- "$sentinel" 2>/dev/null | grep -Fxq -- "$REL"; then
            continue
        fi
        # Line format "<date> <time> <path>" — path at field 3 (see _lib/payload.sh).
        printf '%s %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$REL" >> "$sentinel"
        msg+=" ${SENTINEL_LABELS[$i]}"
    fi
done

if [ -z "$msg" ]; then
    echo "[post-edit] skipped (no trigger matched): $REL"
else
    echo "[post-edit] marked:$msg ($REL)"
fi

exit 0
