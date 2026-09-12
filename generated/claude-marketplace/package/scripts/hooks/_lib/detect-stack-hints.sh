#!/usr/bin/env bash
# Source-only manifest/module-family mismatch detector.
#
# Evidence model: a project's stack is evidenced by its manifests AND, where a
# manifest is absent, by a bounded census of its source files. Manifest-only
# detection is blind to projects that carry a stack's sources without its
# manifest — dhpk's own repository is one, having neither package.json nor
# composer.json while being full of .js.
#
# Evidence validates configuration; it never derives it. Nothing here changes
# which modules SessionStart activates.

# Census bounds. Deliberately small: this runs on every session start, and the
# census only has to answer "does this project contain any of this stack",
# which the first matching file settles. See design D3.
DHPK_STACK_CENSUS_DEPTH="${DHPK_STACK_CENSUS_DEPTH:-6}"
DHPK_STACK_CENSUS_FILES="${DHPK_STACK_CENSUS_FILES:-400}"

# dhpk__stack_source_census <root> — prints any of "js" / "php" found in the
# project's own sources, one per line. Vendored trees are pruned and
# version-control-ignored paths are dropped, so generated and third-party code
# contributes nothing. Bounded by depth and file count; stops early once both
# families are seen.
dhpk__stack_source_census() {
    local root="$1"
    local candidates ignored_blob="" rel nl=$'\n'
    local found_js=0 found_php=0

    # The trailing `|| true` is load-bearing, not defensive noise: callers run
    # under `set -o pipefail` (session-start.sh), and `head` exiting at the file
    # cap SIGPIPEs the upstream `find`/`sed`, making the pipeline status
    # non-zero. Truncation is the intended behaviour, so the status is
    # discarded explicitly rather than left to depend on the caller not
    # checking it.
    candidates="$( { cd "$root" 2>/dev/null && find . -maxdepth "$DHPK_STACK_CENSUS_DEPTH" \
        \( -type d \( -name .git -o -name node_modules -o -name vendor -o -name dist \
           -o -name build -o -name coverage -o -name .next -o -name out -o -name target \
           -o -name .venv -o -name venv -o -name __pycache__ \) -prune \) -o \
        -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
           -o -name '*.ts' -o -name '*.tsx' -o -name '*.vue' -o -name '*.php' \) -print 2>/dev/null \
        | sed 's|^\./||' | head -n "$DHPK_STACK_CENSUS_FILES"; } || true)"
    [ -n "$candidates" ] || return 0

    # One batched check-ignore rather than one per file. Absent or non-git
    # roots simply leave the ignored set empty.
    if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        ignored_blob="$(printf '%s\n' "$candidates" | git -C "$root" check-ignore --stdin 2>/dev/null || true)"
        [ -n "$ignored_blob" ] && ignored_blob="${nl}${ignored_blob}${nl}"
    fi

    while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        if [ -n "$ignored_blob" ]; then
            case "$ignored_blob" in
                *"${nl}${rel}${nl}"*) continue ;;
            esac
        fi
        case "$rel" in
            *.php) found_php=1 ;;
            *)     found_js=1 ;;
        esac
        [ "$found_js" -eq 1 ] && [ "$found_php" -eq 1 ] && break
    done <<< "$candidates"

    [ "$found_js" -eq 1 ] && printf 'js\n'
    [ "$found_php" -eq 1 ] && printf 'php\n'
    return 0
}

# dhpk_collect_stack_evidence <root> — prints a comma-separated list of stack
# families the project evidences: framework families (nextjs / react / vue)
# when a manifest names them, otherwise the bare "js" family, plus "php".
# Prints nothing when the project evidences no stack.
dhpk_collect_stack_evidence() {
    local root="$1" has_js=0 has_php=0 package_text="" census
    local evidence=()

    [ -d "$root" ] || return 0

    if [ -f "$root/package.json" ]; then
        has_js=1
        package_text="$(tr -d '\n' < "$root/package.json" 2>/dev/null || true)"
        printf '%s' "$package_text" | grep -Eq '"next"[[:space:]]*:' && evidence+=(nextjs)
        printf '%s' "$package_text" | grep -Eq '"react"[[:space:]]*:' && evidence+=(react)
        printf '%s' "$package_text" | grep -Eq '"vue"[[:space:]]*:' && evidence+=(vue)
    elif [ -f "$root/pnpm-lock.yaml" ] || [ -f "$root/yarn.lock" ] || [ -f "$root/package-lock.json" ]; then
        has_js=1
    fi
    if [ -f "$root/composer.json" ] || [ -f "$root/composer.lock" ]; then
        has_php=1
    fi

    # The census only runs for families no manifest has already settled.
    if [ "$has_js" -eq 0 ] || [ "$has_php" -eq 0 ]; then
        census="$(dhpk__stack_source_census "$root")"
        case "$census" in *js*)  [ "$has_js" -eq 0 ]  && has_js=1 ;; esac
        case "$census" in *php*) [ "$has_php" -eq 0 ] && has_php=1 ;; esac
    fi

    [ "$has_js" -eq 1 ] && [ "${#evidence[@]}" -eq 0 ] && evidence+=(js)
    [ "$has_php" -eq 1 ] && evidence+=(php)
    [ "${#evidence[@]}" -gt 0 ] || return 0

    (IFS=,; printf '%s' "${evidence[*]}")
}

dhpk_detect_stack_mismatch() {
    local root="$1" configured="$2" has_js=0 has_php=0 evidence_csv=""
    local detected=() suspect=() modules=() module family

    evidence_csv="$(dhpk_collect_stack_evidence "$root")"
    [ -n "$evidence_csv" ] || return 0
    IFS=',' read -r -a detected <<< "$evidence_csv"
    for family in "${detected[@]}"; do
        case "$family" in
            php)               has_php=1 ;;
            js|nextjs|react|vue) has_js=1 ;;
        esac
    done

    IFS=',' read -r -a modules <<< "$configured"
    for module in "${modules[@]}"; do
        module="$(printf '%s' "$module" | xargs)"
        case "$module" in
            # laravel-mix is the JS build-tool module. It must be matched
            # BEFORE the `laravel-*` glob below, which would otherwise claim it
            # for the PHP family — `case` takes the first matching arm, so the
            # order here is load-bearing, not cosmetic.
            js|nextjs-*|react-*|vue-*|laravel-mix)
                [ "$has_js" -eq 1 ] || suspect+=("$module") ;;
            php-*|laravel-*|phpunit-*|yii-*|library-author)
                [ "$has_php" -eq 1 ] || suspect+=("$module") ;;
        esac
    done

    # A contradicted module is a finding on its own merits. This previously also
    # required a detected family with no matching module, which silently dropped
    # the motivating case: dhpk configures `js`, that satisfies the detected js
    # family, so the unmatched-family set was empty and the contradicted PHP
    # modules went unreported. `detected=` now reports what the project actually
    # evidences, which is the useful context and is never empty here.
    [ "${#suspect[@]}" -gt 0 ] || return 0
    local suspect_csv
    suspect_csv="$(IFS=,; printf '%s' "${suspect[*]}")"
    printf 'configured=%s detected=%s' "$suspect_csv" "$evidence_csv"
}
