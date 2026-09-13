#!/usr/bin/env bash
# presets/laravel.sh — Laravel project (artisan-driven, MVC + service layer)
#
# Sort order reflects Laravel's typical deploy concern: domain models →
# infrastructure → HTTP layer → views → assets → routes/config.

PRESET_CATEGORIES='10|^app/Domain/
20|^app/Infrastructure/
30|^app/Http/
31|^app/Models/
32|^app/Services/
33|^app/Console/
40|^database/(migrations|seeders|factories)/
50|^resources/views/
51|^resources/(css|sass|scss|js|ts)/
52|^public/
60|^routes/
70|^config/
80|^lang/|^resources/lang/'

# Laravel build/cache/test artifacts
PRESET_FILTER_EXTRA='^bootstrap/cache/|^storage/|^tests/|^phpunit.*\.xml$|^\.php-cs-fixer.*$|^\.env\.example$|(^|.+/)composer\.(json|lock)$|^artisan$|^package(-lock)?\.json$|^webpack\.mix\.js$|^vite\.config\.(js|ts)$|^\.phpstorm\.meta\.php$|^ide_helper.*$'

PRESET_ROLLBACK_TRIGGER=''

preset_print_stats_body() {
    local php_count js_count blade_count other
    php_count=0; js_count=0; blade_count=0
    if [[ "$MAIN_COUNT" -gt 0 ]]; then
        php_count=$(awk   '/\.php$/'             "$TF_MAIN" | wc -l | tr -d ' ')
        js_count=$(awk    '/\.(js|ts|vue)$/'     "$TF_MAIN" | wc -l | tr -d ' ')
        blade_count=$(awk '/\.blade\.php$/'      "$TF_MAIN" | wc -l | tr -d ' ')
    fi
    # Blade files match .blade.php (a subset of .php), so the breakdown sums to
    # MAIN_COUNT exactly: PHP includes Blade, then JS/TS, then other.
    other=$(( MAIN_COUNT - php_count - js_count ))
    printf -- "- Deployed files: %d (PHP: %d incl. %d Blade, JS/TS: %d, other: %d)\n" \
        "$MAIN_COUNT" "$php_count" "$blade_count" "$js_count" "$other"
    [[ "$WARN_COUNT" -gt 0 ]] && \
        printf -- "- Out of scope: %d (listed only, not counted)\n" "$WARN_COUNT"
    printf -- "- Diff range: %s...%s (raw %d files, %d filtered out)\n" \
        "$BASE" "$HEAD_REF" "$RAW_TOTAL" "$FILTERED_OUT"
    [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]] && \
        printf -- "- Pinned commits: %d\n" "${#DEPLOY_SHAS[@]}"
}

preset_print_filtered_body() {
    printf -- "- Tests (tests/): %d\n"          "$(count_raw '^tests/')"
    printf -- "- Bootstrap/storage cache: %d\n" "$(count_raw '^bootstrap/cache/|^storage/')"
    printf -- "- Docs (docs/, README, CLAUDE.md): %d\n" "$(count_raw '^docs/|^README|(^|.+/)CLAUDE\.md$')"
    printf -- "- AI harness (.claude/, .codex/, .gemini/, .agents/): %d\n" "$(count_raw '^\.claude/|^\.codex/|^\.gemini/|^\.agents/')"
    printf -- "- CI / tooling / build config: %d\n" "$(count_raw '^\.github/|^phpunit.*\.xml$|^\.gitignore$|^artisan$|^webpack\.mix\.js$|^vite\.config\.(js|ts)$|(^|.+/)composer\.(json|lock)$|^package(-lock)?\.json$')"
}

preset_print_rollback_body() {
    :
}
