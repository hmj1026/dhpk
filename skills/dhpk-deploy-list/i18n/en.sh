#!/usr/bin/env bash
# i18n/en.sh — English labels for deploy-list structural headers
#
# Only universal structural labels are translated. Per-preset content
# (📊 stats body, 🚫 filtered body, 🔁 rollback body) is owned by the
# preset file itself.

LBL_UPDATE_TIME_LINE="Update time: %s"
LBL_UPDATE_TAG_LINE="Update tag: %s %s %s %s"
LBL_UPDATE_PROJECT_LINE="Update project: %s"
LBL_UPDATE_FILES_PINNED_LINE="Update files: (pinned %d commit(s), %d file(s) after filter)"
LBL_UPDATE_FILES_RANGE_LINE="Update files: (%s...%s full diff, %d file(s) after filter)"
LBL_UPDATE_FILES_ANCHOR_LINE="Update files: (%d file(s) matched by anchor grep)"

LBL_NO_DEPLOY_FILES="(no deploy files: diff is entirely docs / tests / harness)"
LBL_NO_DEPLOY_FILES_ANCHOR="(no deploy files: anchor string did not match, or all hits were filtered by preset)"

LBL_OUT_OF_SCOPE_HEADER_TPL="⚠️ Out of scope (%s...%s accumulated %d file(s) outside the pinned commits)"
LBL_OUT_OF_SCOPE_NOTE="   These files are not in any --deploy-commits SHA. Confirm before deploying."

LBL_STATS_HEADER="📊 Stats"
LBL_FILTERED_HEADER="🚫 Filtered out (not deployed)"
LBL_ROLLBACK_HEADER="🔁 Rollback hints"

LBL_WARN_BASE_HEAD_SAME_TPL="⚠️  %s and HEAD are the same, automatically switched to %s...%s"

LBL_NOTE_REPLAY_TPL="NOTE: the following commit(s) are already inside %s (historical replay, no output impact): %s"
