#!/usr/bin/env bash
# Source-only manifest/module-family mismatch detector.

dhpk_detect_stack_mismatch() {
    local root="$1" configured="$2" has_js=0 has_php=0 package_text=""
    local detected=() suspect=() missing=() modules=() module

    if [ -f "$root/package.json" ]; then
        has_js=1
        package_text="$(tr -d '\n' < "$root/package.json" 2>/dev/null || true)"
        printf '%s' "$package_text" | grep -Eq '"next"[[:space:]]*:' && detected+=(nextjs)
        printf '%s' "$package_text" | grep -Eq '"react"[[:space:]]*:' && detected+=(react)
        printf '%s' "$package_text" | grep -Eq '"vue"[[:space:]]*:' && detected+=(vue)
    elif [ -f "$root/pnpm-lock.yaml" ] || [ -f "$root/yarn.lock" ] || [ -f "$root/package-lock.json" ]; then
        has_js=1
    fi
    [ "$has_js" -eq 1 ] && [ "${#detected[@]}" -eq 0 ] && detected+=(js)
    if [ -f "$root/composer.json" ] || [ -f "$root/composer.lock" ]; then
        has_php=1
        detected+=(php)
    fi
    [ "${#detected[@]}" -gt 0 ] || return 0

    IFS=',' read -r -a modules <<< "$configured"
    for module in "${modules[@]}"; do
        module="$(printf '%s' "$module" | xargs)"
        case "$module" in
            php-*|laravel-*|phpunit-*|yii-*|library-author)
                [ "$has_php" -eq 1 ] || suspect+=("$module") ;;
            js|nextjs-*|react-*|vue-*|laravel-mix)
                [ "$has_js" -eq 1 ] || suspect+=("$module") ;;
        esac
    done

    for family in "${detected[@]}"; do
        found=0
        for module in "${modules[@]}"; do
            module="$(printf '%s' "$module" | xargs)"
            case "$family:$module" in
                php:php-*|php:laravel-*|php:phpunit-*|php:yii-*|php:library-author|\
                js:js|js:nextjs-*|js:react-*|js:vue-*|js:laravel-mix|\
                nextjs:js|nextjs:nextjs-*|react:js|react:react-*|vue:js|vue:vue-*) found=1 ;;
            esac
        done
        [ "$found" -eq 1 ] || missing+=("$family")
    done

    [ "${#suspect[@]}" -gt 0 ] && [ "${#missing[@]}" -gt 0 ] || return 0
    local suspect_csv detected_csv
    suspect_csv="$(IFS=,; printf '%s' "${suspect[*]}")"
    detected_csv="$(IFS=,; printf '%s' "${missing[*]}")"
    printf 'configured=%s detected=%s' "$suspect_csv" "$detected_csv"
}
