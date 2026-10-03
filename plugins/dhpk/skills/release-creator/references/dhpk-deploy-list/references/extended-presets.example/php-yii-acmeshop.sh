#!/usr/bin/env bash
# EXAMPLE — not active. Fictional company-derived preset that shows how to
# extend the stock php-yii preset with DDD overlay, a rollback hint, and a
# bilingual stats body.
#
# Copy this file to `presets/<your-name>.sh`, rename the ACMESHOP_* paths
# and the rollback hint to match your project, then pin it via `config.sh`'s
# `DEFAULT_PRESET=<your-name>`.
#
# Preset contract (every preset must export these):
#   PRESET_CATEGORIES        newline-delim "<sort-key>|<awk-ERE>"; first match
#                            wins for category assignment; sort-key drives
#                            output order (lexicographic — keep monotonic).
#   PRESET_FILTER_EXTRA      ERE alternation appended to the universal filter
#                            base. Files matching the composed filter are
#                            excluded from both main and warn groups.
#   PRESET_ROLLBACK_TRIGGER  Awk regex tested against the main group; any line
#                            matching → the 🔁 Rollback hints section is
#                            emitted via preset_print_rollback_body.
#   preset_print_stats_body  📊 stats body — the preset owns the wording.
#   preset_print_filtered_body  🚫 filtered-out body — same.
#   preset_print_rollback_body  🔁 rollback body — only called when the
#                               trigger matched at least one file.
#
# Inherits `set -uo pipefail` from the main script — any undefined variable
# inside `preset_print_*` aborts with nounset. Use `${var:-default}` for
# optional reads.

# AcmeShop (fictional) is a legacy PHP 5.6 + Yii 1.1 app that grew a DDD
# overlay (domain/ + infrastructure/) and a frontend JS modular bundle
# (entry: js/acmebundle.v2.js, modules: js/acmebundle/*.js, legacy
# fallback: js/acmebundle.js — toggled via a single config switch).
#
# Sort order (output direction):
#   1=domain → 2=infrastructure → 31-37=protected/* layers
#   → 4=css/themes/static → 51=js root → 52=js/acmebundle.v2.js
#   → 53=js/acmebundle/ → 99=anything else
#
# Match order (top-to-bottom in the file, first hit wins for category
# assignment): more-specific patterns FIRST.
PRESET_CATEGORIES='1|^domain/
2|^infrastructure/
31|^protected/commands/
32|^protected/components/
33|^protected/controllers/
34|^protected/extensions/
35|^protected/models/
36|^protected/modules/
37|^protected/views/
4|^(css|themes|images|media|fonts)/
52|^js/acmebundle[.]v2[.]js$
53|^js/acmebundle/
51|^js/[^/]+[.]js$'

# Extra filter — typical noise in a long-running PHP/Yii app:
#   - verification/, *_CHECKLIST.md, *_SKILL_OUTPUT.md: in-house ops artifacts
#   - protected/tests/, js/tests/, js/docs/: framework test/docs conventions
#   - jest/playwright/phpunit/phpcs configs: test runners
#   - composer / package-lock / Procfile: deploy platform metadata
#   - scripts/check-*, scripts/worktree-*, *-smoke.sh: local ops scripts
#   - ide_helper.php, Glob.php: Yii IDE-meta files
#   - js/acmebundle.js: legacy monolith — loaded via runtime toggle, not
#     directly deployed
PRESET_FILTER_EXTRA='^verification/|^.*_CHECKLIST\.md$|^.*_SKILL_OUTPUT\.md$|^protected/tests/|^js/tests/|^js/docs/|^jest\.config\.js$|^playwright\.config\.js$|^package(-lock)?\.json$|^phpcs\.xml$|^phpunit.*\.xml$|^Procfile|(^|.+/)composer\.(json|lock)$|^scripts/check-|^scripts/worktree-|^scripts/.*-smoke\.sh$|^ide_helper\.php$|^Glob\.php$|^js/acmebundle\.js$'

# When any file under the modular bundle paths changes, surface the
# rollback hint — ops needs the fast-toggle path on deploy regression.
PRESET_ROLLBACK_TRIGGER='^js/acmebundle/|^js/acmebundle[.]v2[.]js$'

# Bilingual stats body — picks language from $LANG (the deploy-list --lang
# value, propagated by the main script).
preset_print_stats_body() {
    local php_count js_count other
    php_count=0; js_count=0
    if [[ "$MAIN_COUNT" -gt 0 ]]; then
        php_count=$(awk '/\.php$/' "$TF_MAIN" | wc -l | tr -d ' ')
        js_count=$(awk  '/\.js$/'  "$TF_MAIN" | wc -l | tr -d ' ')
    fi
    other=$(( MAIN_COUNT - php_count - js_count ))

    if [[ "${LANG:-en}" == "zh-TW" ]]; then
        printf -- "- 部署檔案：%d 個（PHP: %d, JS: %d, 其他: %d）\n" \
            "$MAIN_COUNT" "$php_count" "$js_count" "$other"
        [[ "$WARN_COUNT" -gt 0 ]] && \
            printf -- "- 非本次部署範圍：%d 個（僅列示，不計入部署數）\n" "$WARN_COUNT"
        if [[ "${ANCHOR_MODE:-0}" -eq 1 ]]; then
            printf -- "- anchor 範圍：source 樹 rg 命中 %d 個（過濾掉 %d 個）\n" \
                "$RAW_TOTAL" "$FILTERED_OUT"
            printf -- "- Anchor 字串：%s\n" "$ANCHOR"
        else
            printf -- "- diff 範圍：%s...%s（共 %d 個原始檔案，過濾掉 %d 個）\n" \
                "$BASE" "$HEAD_REF" "$RAW_TOTAL" "$FILTERED_OUT"
            [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]] && \
                printf -- "- 指定 commit 數：%d 個\n" "${#DEPLOY_SHAS[@]}"
        fi
    else
        printf -- "- Deployed files: %d (PHP: %d, JS: %d, other: %d)\n" \
            "$MAIN_COUNT" "$php_count" "$js_count" "$other"
        [[ "$WARN_COUNT" -gt 0 ]] && \
            printf -- "- Out of scope: %d (listed only, not counted)\n" "$WARN_COUNT"
        if [[ "${ANCHOR_MODE:-0}" -eq 1 ]]; then
            printf -- "- Anchor scope: source tree rg matched %d (filtered %d)\n" \
                "$RAW_TOTAL" "$FILTERED_OUT"
            printf -- "- Anchor string: %s\n" "$ANCHOR"
        else
            printf -- "- Diff range: %s...%s (raw %d files, %d filtered out)\n" \
                "$BASE" "$HEAD_REF" "$RAW_TOTAL" "$FILTERED_OUT"
            [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]] && \
                printf -- "- Pinned commits: %d\n" "${#DEPLOY_SHAS[@]}"
        fi
    fi
}

preset_print_filtered_body() {
    local n_tests n_docs n_harness n_ci
    n_tests=$(count_raw   '^protected/tests/|^js/tests/')
    n_docs=$(count_raw    '^docs/|^openspec/')
    n_harness=$(count_raw '^\.claude/|^\.codex/|^\.gemini/|^\.agents/')
    n_ci=$(count_raw      '^\.github/|^jest\.config\.js$|^playwright\.config\.js$|^package(-lock)?\.json$|^\.gitignore$|^verification/|^scripts/check-|^scripts/worktree-|^scripts/.*-smoke\.sh$')

    if [[ "${LANG:-en}" == "zh-TW" ]]; then
        printf -- "- 測試（protected/tests/ / js/tests/）：%d 個\n" "$n_tests"
        printf -- "- 文件（docs/ / openspec/ / CLAUDE.md 等）：%d 個\n" "$n_docs"
        printf -- "- AI harness（.claude/ / .codex/ / .gemini/ / .agents/）：%d 個\n" "$n_harness"
        printf -- "- CI / 工具腳本 / IDE meta：%d 個\n" "$n_ci"
    else
        printf -- "- Tests (protected/tests/, js/tests/): %d\n" "$n_tests"
        printf -- "- Docs (docs/, openspec/, CLAUDE.md, ...): %d\n" "$n_docs"
        printf -- "- AI harness (.claude/, .codex/, .gemini/, .agents/): %d\n" "$n_harness"
        printf -- "- CI / tooling / IDE meta: %d\n" "$n_ci"
    fi
}

preset_print_rollback_body() {
    # The exact file path + config-key string is project-specific — keep it
    # accurate so ops can act on it without grepping for the source file.
    if [[ "${LANG:-en}" == "zh-TW" ]]; then
        printf -- '- 如部署後 modular path 有問題：編輯 `protected/views/layouts/_acme_modular_assets.php`\n'
        printf -- '  將 `$useModularBundle = true;` 改為 `false;`、上傳該單檔即可切回 legacy `js/acmebundle.js`。\n'
        printf -- '  詳見 `docs/refactor/acme-bundle/rollback.md`。\n'
    else
        printf -- '- If the modular path breaks after deploy: edit `protected/views/layouts/_acme_modular_assets.php`,\n'
        printf -- '  change `$useModularBundle = true;` to `false;`, upload only that file to fall back to legacy `js/acmebundle.js`.\n'
        printf -- '  See `docs/refactor/acme-bundle/rollback.md` for details.\n'
    fi
}
