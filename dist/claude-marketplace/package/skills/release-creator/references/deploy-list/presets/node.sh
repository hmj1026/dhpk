#!/usr/bin/env bash
# presets/node.sh — Node.js / TypeScript project (monorepo or single package)
#
# Categories handle both monorepo (packages/<pkg>/src) and single-app
# (src/) layouts. Tighter patterns checked first.

PRESET_CATEGORIES='10|^packages/[^/]+/src/types/
11|^packages/[^/]+/src/core/
12|^packages/[^/]+/src/
13|^packages/[^/]+/lib/
20|^apps/[^/]+/src/
21|^apps/[^/]+/
30|^src/types/
31|^src/core/
32|^src/
40|^lib/
50|^public/|^static/
60|^server/|^api/'

# Node build/cache/test artifacts
PRESET_FILTER_EXTRA='^dist/|^build/|^coverage/|^node_modules/|^\.next/|^\.nuxt/|^\.cache/|^\.turbo/|^out/|^tests?/|^__tests__/|^__mocks__/|.+\.test\.(js|ts|tsx|jsx)$|.+\.spec\.(js|ts|tsx|jsx)$|^jest\.config\.(js|ts|cjs|mjs)$|^vitest\.config\.(js|ts)$|^playwright\.config\.(js|ts)$|^package(-lock)?\.json$|^yarn\.lock$|^pnpm-lock\.yaml$|^tsconfig.*\.json$|^\.eslintrc.*$|^\.prettierrc.*$'

PRESET_ROLLBACK_TRIGGER=''

preset_print_stats_body() {
    local ts_count js_count css_count other
    ts_count=0; js_count=0; css_count=0
    if [[ "$MAIN_COUNT" -gt 0 ]]; then
        ts_count=$(awk  '/\.(ts|tsx)$/'         "$TF_MAIN" | wc -l | tr -d ' ')
        js_count=$(awk  '/\.(js|jsx|mjs|cjs)$/' "$TF_MAIN" | wc -l | tr -d ' ')
        css_count=$(awk '/\.(css|scss|sass)$/'  "$TF_MAIN" | wc -l | tr -d ' ')
    fi
    other=$(( MAIN_COUNT - ts_count - js_count - css_count ))
    printf -- "- Deployed files: %d (TS: %d, JS: %d, CSS: %d, other: %d)\n" \
        "$MAIN_COUNT" "$ts_count" "$js_count" "$css_count" "$other"
    [[ "$WARN_COUNT" -gt 0 ]] && \
        printf -- "- Out of scope: %d (listed only, not counted)\n" "$WARN_COUNT"
    printf -- "- Diff range: %s...%s (raw %d files, %d filtered out)\n" \
        "$BASE" "$HEAD_REF" "$RAW_TOTAL" "$FILTERED_OUT"
    [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]] && \
        printf -- "- Pinned commits: %d\n" "${#DEPLOY_SHAS[@]}"
}

preset_print_filtered_body() {
    printf -- "- Tests (tests/, __tests__/, *.test.*, *.spec.*): %d\n" \
        "$(count_raw '^tests?/|^__tests__/|.+\.(test|spec)\.(js|ts|tsx|jsx)$')"
    printf -- "- Build artifacts (dist/, build/, coverage/, .next/, .nuxt/): %d\n" \
        "$(count_raw '^dist/|^build/|^coverage/|^\.next/|^\.nuxt/|^out/')"
    printf -- "- Docs (docs/, README, CLAUDE.md): %d\n" \
        "$(count_raw '^docs/|^README|(^|.+/)CLAUDE\.md$')"
    printf -- "- AI harness (.claude/, .codex/, .gemini/, .agents/): %d\n" \
        "$(count_raw '^\.claude/|^\.codex/|^\.gemini/|^\.agents/')"
    printf -- "- CI / tooling / build config: %d\n" \
        "$(count_raw '^\.github/|^jest\.config\..*|^vitest\.config\..*|^playwright\.config\..*|^tsconfig.*\.json$|^package(-lock)?\.json$|^yarn\.lock$|^pnpm-lock\.yaml$|^\.eslintrc.*|^\.prettierrc.*|^\.gitignore$')"
}

preset_print_rollback_body() {
    :
}
