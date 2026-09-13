#!/usr/bin/env bash
# js-tier-detect.sh — shared JS tier detection for the dhpk JS module.
# Source-only — do not execute directly.
# Consumers: post-edit-js-lint.sh and any future JS module hook needing the
# same vendor / core / frontend split.
#
# Contract:
#   detect_js_tier "<relative-path-from-repo-root>"
#   exports JS_TIER ∈ {"frontend", "vendor", "non-js"}
#   exit code 0 always (caller checks $JS_TIER).
#
# Configuration source: modules/js/module.yaml — block `js:` with keys
# frontend_roots (default ["js","src"]), core_files (default []), vendor_globs
# (default []). Falls back to safe defaults if python3 / module.yaml missing
# so the hook never errors a user out.

# Module config — populated by _dhpk_js_load_config (lazy, only once per hook run).
DHPK_JS_FRONTEND_ROOTS=()
DHPK_JS_CORE_FILES=()
DHPK_JS_VENDOR_GLOBS=()
_dhpk_js_config_loaded=0

_dhpk_js_load_config() {
    [ "$_dhpk_js_config_loaded" -eq 1 ] && return 0
    _dhpk_js_config_loaded=1

    local plugin_root="${CLAUDE_PLUGIN_ROOT:-}"
    if [ -z "$plugin_root" ]; then
        # Fall back: assume two parents up from this lib (modules/js/hooks/_lib).
        plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." 2>/dev/null && pwd)"
    fi
    local yaml="$plugin_root/modules/js/module.yaml"

    # Safe defaults — JS files under js/ or src/ subdirs become frontend.
    DHPK_JS_FRONTEND_ROOTS=("js" "src")
    DHPK_JS_CORE_FILES=()
    DHPK_JS_VENDOR_GLOBS=()

    [ -f "$yaml" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0

    # Parse the `js:` block. Output three newline-separated sections marked
    # with sentinel headers so bash can split deterministically.
    local parsed
    parsed="$(python3 - "$yaml" <<'PY' 2>/dev/null || true
import sys
try:
    with open(sys.argv[1]) as f:
        text = f.read()
except Exception:
    sys.exit(0)
def _list(line):
    v = line.split(":", 1)[1].strip()
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [x.strip().strip('"').strip("'") for x in inner.split(",") if x.strip()]
    return None
in_js = False
roots = None
cores = None
vendors = None
for raw in text.splitlines():
    line = raw.rstrip()
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    indent = len(line) - len(line.lstrip())
    if indent == 0 and line.rstrip(":") == "js" and line.endswith(":"):
        in_js = True
        continue
    if indent == 0 and in_js:
        in_js = False
    if in_js and indent >= 2:
        s = line.strip()
        if s.startswith("frontend_roots:"):
            v = _list(s);  roots = v if v is not None else roots
        elif s.startswith("core_files:"):
            v = _list(s);  cores = v if v is not None else cores
        elif s.startswith("vendor_globs:"):
            v = _list(s);  vendors = v if v is not None else vendors
print("ROOTS")
for r in (roots or []):
    print(r)
print("CORES")
for c in (cores or []):
    print(c)
print("VENDORS")
for v in (vendors or []):
    print(v)
PY
    )"

    [ -z "$parsed" ] && return 0

    local section=""
    local roots=() cores=() vendors=()
    while IFS= read -r line; do
        case "$line" in
            ROOTS) section="roots" ;;
            CORES) section="cores" ;;
            VENDORS) section="vendors" ;;
            "") ;;
            *)
                case "$section" in
                    roots) roots+=("$line") ;;
                    cores) cores+=("$line") ;;
                    vendors) vendors+=("$line") ;;
                esac
                ;;
        esac
    done <<< "$parsed"

    # Override defaults only when the YAML explicitly listed values.
    [ "${#roots[@]}" -gt 0 ] && DHPK_JS_FRONTEND_ROOTS=("${roots[@]}")
    DHPK_JS_CORE_FILES=("${cores[@]}")
    DHPK_JS_VENDOR_GLOBS=("${vendors[@]}")

    # Project overrides (highest precedence) — userConfig js_frontend_roots /
    # js_core_files / js_vendor_globs arrive comma-joined via
    # CLAUDE_PLUGIN_OPTION_* (load-project-config.sh exports them). Lets each
    # project curate its tier lists without editing the shared module.yaml.
    if [ -n "${CLAUDE_PLUGIN_OPTION_JS_FRONTEND_ROOTS:-}" ]; then
        IFS=',' read -r -a DHPK_JS_FRONTEND_ROOTS <<< "${CLAUDE_PLUGIN_OPTION_JS_FRONTEND_ROOTS}"
    fi
    if [ -n "${CLAUDE_PLUGIN_OPTION_JS_CORE_FILES:-}" ]; then
        IFS=',' read -r -a DHPK_JS_CORE_FILES <<< "${CLAUDE_PLUGIN_OPTION_JS_CORE_FILES}"
    fi
    if [ -n "${CLAUDE_PLUGIN_OPTION_JS_VENDOR_GLOBS:-}" ]; then
        IFS=',' read -r -a DHPK_JS_VENDOR_GLOBS <<< "${CLAUDE_PLUGIN_OPTION_JS_VENDOR_GLOBS}"
    fi
}

detect_js_tier() {
    local rel="$1"
    local basename="${rel##*/}"
    JS_TIER="non-js"

    case "$basename" in
        *.js|*.ts|*.jsx|*.tsx|*.mjs|*.cjs|*.vue|*.svelte) ;;
        *) return 0 ;;
    esac

    _dhpk_js_load_config

    # vendor_globs: explicit project-curated skip list (any depth).
    local g
    for g in "${DHPK_JS_VENDOR_GLOBS[@]}"; do
        case "$rel" in
            $g|$g*) JS_TIER="vendor"; return 0 ;;
        esac
    done

    # frontend_roots: anything under <root>/ is candidate. Files at root level
    # are vendor unless their basename is in core_files; subdir files are
    # frontend.
    local root
    for root in "${DHPK_JS_FRONTEND_ROOTS[@]}"; do
        case "$rel" in
            "$root"/*/*)
                JS_TIER="frontend"
                return 0
                ;;
            "$root"/*)
                local core is_core=0
                for core in "${DHPK_JS_CORE_FILES[@]}"; do
                    [ "$basename" = "$core" ] && is_core=1 && break
                done
                if [ "$is_core" -eq 1 ]; then
                    JS_TIER="frontend"
                else
                    JS_TIER="vendor"
                fi
                return 0
                ;;
        esac
    done

    # Outside every frontend_root → non-js (lint hook silent-skips). Projects
    # that lay out JS under a non-listed root should add it to frontend_roots.
    return 0
}
