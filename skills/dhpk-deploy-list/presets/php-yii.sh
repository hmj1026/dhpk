#!/usr/bin/env bash
# presets/php-yii.sh — generic PHP/Yii 1.x project (Yii framework conventions)
#
# Stock Yii 1.x protected/* layout. Projects layering a DDD architecture on
# top (domain/, infrastructure/) or adding rollback-sensitive paths should
# copy this preset and extend — see references/presets.md "Adding a custom
# preset" and the worked example at references/extended-presets.example/.

# Categories: framework conventions over DDD
#   10=protected/commands  20=protected/components  30=protected/controllers
#   31=protected/extensions  32=protected/models  33=protected/modules
#   34=protected/views  40=assets/themes/images/media/fonts  50=js  99=其他
PRESET_CATEGORIES='10|^protected/commands/
20|^protected/components/
30|^protected/controllers/
31|^protected/extensions/
32|^protected/models/
33|^protected/modules/
34|^protected/views/
40|^(css|themes|images|media|fonts|assets)/
50|^js/[^/]+[.]js$
51|^js/'

# PHP/Yii build & test artifacts that don't belong on deploy targets
PRESET_FILTER_EXTRA='^protected/tests/|^tests/|^phpunit.*\.xml$|^phpcs\.xml$|^\.php-cs-fixer.*$|(^|.+/)composer\.(json|lock)$|^ide_helper\.php$|^\.phpstorm\.meta\.php$'

# No rollback trigger by default (per-project may add via custom preset)
PRESET_ROLLBACK_TRIGGER=''

preset_print_stats_body() {
    local php_count js_count other
    php_count=0; js_count=0
    if [[ "$MAIN_COUNT" -gt 0 ]]; then
        php_count=$(awk '/\.php$/' "$TF_MAIN" | wc -l | tr -d ' ')
        js_count=$(awk  '/\.js$/'  "$TF_MAIN" | wc -l | tr -d ' ')
    fi
    other=$(( MAIN_COUNT - php_count - js_count ))
    printf -- "- Deployed files: %d (PHP: %d, JS: %d, other: %d)\n" \
        "$MAIN_COUNT" "$php_count" "$js_count" "$other"
    [[ "$WARN_COUNT" -gt 0 ]] && \
        printf -- "- Out of scope: %d (listed only, not counted)\n" "$WARN_COUNT"
    printf -- "- Diff range: %s...%s (raw %d files, %d filtered out)\n" \
        "$BASE" "$HEAD_REF" "$RAW_TOTAL" "$FILTERED_OUT"
    [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]] && \
        printf -- "- Pinned commits: %d\n" "${#DEPLOY_SHAS[@]}"
}

preset_print_filtered_body() {
    printf -- "- Tests (protected/tests/, tests/): %d\n"  "$(count_raw '^protected/tests/|^tests/')"
    printf -- "- Docs (docs/, README, CLAUDE.md, ...): %d\n" "$(count_raw '^docs/|^README|(^|.+/)CLAUDE\.md$')"
    printf -- "- AI harness (.claude/, .codex/, .gemini/, .agents/): %d\n" "$(count_raw '^\.claude/|^\.codex/|^\.gemini/|^\.agents/')"
    printf -- "- CI / tooling: %d\n" "$(count_raw '^\.github/|^phpunit.*\.xml$|^phpcs\.xml$|^\.gitignore$|(^|.+/)composer\.(json|lock)$')"
}

preset_print_rollback_body() {
    # No-op for generic php-yii (project can override via custom preset)
    :
}
