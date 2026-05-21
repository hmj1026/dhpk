# Squash-merge hygiene

When a feature branch's multiple commits get squashed into one commit on the integration branch, surprise changes get hidden inside the squash. The PR description must surface them.

## Hard rule

Every squash-merged PR description SHALL include an `## Unrelated Changes` section.

The section lists changes that are NOT functionally related to the PR's main title, grouped by topic. Each group includes:

- File paths (or path prefixes)
- Line count delta
- Why it was mixed in
- Suggested reviewer (if any)

## What counts as "unrelated"

| Category | Unrelated? |
|----------|-----------|
| Reformatting touched lines | No (inevitable churn) |
| README typo fix | No |
| CI yml micro-tweak | No |
| New controller action | Yes |
| New service / refactor | Yes |
| Schema change | Yes |
| Cron job change | Yes |
| Visibility refactor (`private` → `protected`) | Yes |
| Service factory extraction | Yes |

When in doubt: would a reviewer be surprised to see this in a PR titled X? → unrelated.

## Enforcement

Project may ship a `scripts/check-unrelated-changes.sh` advisory hook that warns when the PR description lacks the section. This is advisory (does NOT block merge) — final judgment is the author's.

Historical squashes that violate the rule SHOULD be backfilled with a separate review document (e.g. `docs/squash-<sha>-unrelated.md`). DO NOT rewrite git history.
