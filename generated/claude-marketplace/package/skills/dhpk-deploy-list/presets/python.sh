#!/usr/bin/env bash
# presets/python.sh — Python project (src/<pkg>/ + migrations + templates)

PRESET_CATEGORIES='10|^src/[^/]+/core/
11|^src/[^/]+/models/
12|^src/[^/]+/services/
13|^src/[^/]+/
20|^[^/]+/core/
21|^[^/]+/models/
22|^[^/]+/api/
30|^(migrations|alembic)/
40|^templates/
50|^static/|^public/
60|^scripts/'

# Python build/cache/test artifacts
PRESET_FILTER_EXTRA='^\.venv/|^venv/|^env/|^__pycache__/|.+\.pyc$|.+\.pyo$|^build/|^dist/|^\.eggs/|.+\.egg-info/|^htmlcov/|^\.coverage$|^\.pytest_cache/|^\.mypy_cache/|^\.ruff_cache/|^\.tox/|^tests?/|.+/tests?/|^test_.+\.py$|.+_test\.py$|^pytest\.ini$|^setup\.cfg$|^pyproject\.toml$|^setup\.py$|^requirements.*\.txt$|^Pipfile.*$|^poetry\.lock$|^MANIFEST\.in$'

PRESET_ROLLBACK_TRIGGER=''

preset_print_stats_body() {
    local py_count tpl_count other
    py_count=0; tpl_count=0
    if [[ "$MAIN_COUNT" -gt 0 ]]; then
        py_count=$(awk  '/\.py$/'              "$TF_MAIN" | wc -l | tr -d ' ')
        tpl_count=$(awk '/\.(html|jinja2|j2)$/' "$TF_MAIN" | wc -l | tr -d ' ')
    fi
    other=$(( MAIN_COUNT - py_count - tpl_count ))
    printf -- "- Deployed files: %d (Python: %d, templates: %d, other: %d)\n" \
        "$MAIN_COUNT" "$py_count" "$tpl_count" "$other"
    [[ "$WARN_COUNT" -gt 0 ]] && \
        printf -- "- Out of scope: %d (listed only, not counted)\n" "$WARN_COUNT"
    printf -- "- Diff range: %s...%s (raw %d files, %d filtered out)\n" \
        "$BASE" "$HEAD_REF" "$RAW_TOTAL" "$FILTERED_OUT"
    [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]] && \
        printf -- "- Pinned commits: %d\n" "${#DEPLOY_SHAS[@]}"
}

preset_print_filtered_body() {
    printf -- "- Tests (tests/, test_*.py, *_test.py): %d\n" \
        "$(count_raw '^tests?/|.+/tests?/|^test_.+\.py$|.+_test\.py$')"
    printf -- "- Python cache (__pycache__/, *.pyc, .mypy_cache/, .pytest_cache/): %d\n" \
        "$(count_raw '^__pycache__/|.+\.pyc$|^\.mypy_cache/|^\.pytest_cache/|^\.ruff_cache/')"
    printf -- "- Build artifacts (build/, dist/, *.egg-info/, .tox/): %d\n" \
        "$(count_raw '^build/|^dist/|^\.eggs/|.+\.egg-info/|^\.tox/')"
    printf -- "- Docs (docs/, README, CLAUDE.md): %d\n" \
        "$(count_raw '^docs/|^README|(^|.+/)CLAUDE\.md$')"
    printf -- "- AI harness (.claude/, .codex/, .gemini/, .agents/): %d\n" \
        "$(count_raw '^\.claude/|^\.codex/|^\.gemini/|^\.agents/')"
    printf -- "- CI / packaging / config: %d\n" \
        "$(count_raw '^\.github/|^pytest\.ini$|^setup\.cfg$|^pyproject\.toml$|^setup\.py$|^requirements.*\.txt$|^Pipfile.*$|^poetry\.lock$|^\.gitignore$')"
}

preset_print_rollback_body() {
    :
}
