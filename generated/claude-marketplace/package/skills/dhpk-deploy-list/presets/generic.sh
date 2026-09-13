#!/usr/bin/env bash
# presets/generic.sh — Language-agnostic fallback (any repo)
#
# Used when:
#   - --preset generic explicitly
#   - auto-detect doesn't recognise the repo
# Conservative categorization: src/ > lib/ > config/ > assets/static/public.

PRESET_CATEGORIES='10|^src/
20|^lib/
30|^config/
40|^(assets|public|static)/
50|^scripts/'

# Only universal artifacts are filtered. Project-specific filters belong in
# a custom preset (copy generic.sh, rename, edit).
PRESET_FILTER_EXTRA=''

PRESET_ROLLBACK_TRIGGER=''

preset_print_stats_body() {
    printf -- "- Deployed files: %d\n" "$MAIN_COUNT"
    [[ "$WARN_COUNT" -gt 0 ]] && \
        printf -- "- Out of scope: %d (listed only, not counted)\n" "$WARN_COUNT"
    printf -- "- Diff range: %s...%s (raw %d files, %d filtered out)\n" \
        "$BASE" "$HEAD_REF" "$RAW_TOTAL" "$FILTERED_OUT"
    [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]] && \
        printf -- "- Pinned commits: %d\n" "${#DEPLOY_SHAS[@]}"
}

preset_print_filtered_body() {
    printf -- "- Docs (docs/, README, CLAUDE.md): %d\n" \
        "$(count_raw '^docs/|^README|(^|.+/)CLAUDE\.md$')"
    printf -- "- AI harness (.claude/, .codex/, .gemini/, .agents/): %d\n" \
        "$(count_raw '^\.claude/|^\.codex/|^\.gemini/|^\.agents/')"
    printf -- "- CI / IDE meta: %d\n" \
        "$(count_raw '^\.github/|^\.gitignore$|^\.idea/|^\.vscode/')"
}

preset_print_rollback_body() {
    :
}
