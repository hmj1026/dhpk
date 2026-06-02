---
description: Generate a cross-project deploy file list (schema=v1). Preset-driven categorization (php-yii / laravel / node / python / generic; projects extend with their own preset). tag is metadata only; default mode is anchor-grep on source-tree inline markers.
argument-hint: <date> <author> <[tag]><description> [--anchor STRING | --deploy-commits SHA1,SHA2,...] [--date YYYY/MM/DD] [--author NAME] [--project NAME] [--base REF] [--head REF] [--preset NAME] [--lang en|zh-TW]
---

# /deploy-list — cross-project deploy file list generator

All logic in `skills/deploy-list/scripts/deploy-list.sh` (schema=v1). This command
parses arguments, invokes the script, and emits the script's stdout **verbatim** — no
post-processing, no reordering, no summarization.

## Parsing $ARGUMENTS

Positional-then-flag form, in any order after the first two positionals:

1. **Positional `date`**: first `YYYY/MM/DD` token before `[tag]` → `DATE`
2. **Positional `author`**: single non-flag token between `date` and `[tag]` → `AUTHOR`
3. **`[tag]` (required)**: first token matching `^\[.+\]$` — pure metadata, not used for grouping
4. **`description` (required)**: remainder text after `[tag]` (excluding flag tokens)
5. **Flags** (any order):
   - `--anchor STRING` — source-tree inline marker (preferred default; see "Mode selection" below)
   - `--deploy-commits SHA1,SHA2,...` — CSV of commit SHAs to pin as the main group
   - `--date YYYY/MM/DD`, `--author NAME`, `--project NAME`
   - `--base REF`, `--head REF` (ignored in anchor mode)
   - `--preset NAME` — `php-yii` / `laravel` / `node` / `python` / `generic` (or a project-supplied preset; see `skills/deploy-list/scripts/presets/`)
   - `--lang CODE` — `zh-TW` or `en`
   - `--auto-detect-tag` — optional; try `grep -i -F [tag]` on commit messages to auto-fill `--deploy-commits`

Defaults (read from `config.sh` if present, else hardcoded):
`--date` today / `--author` $USER / `--base` master / `--head` HEAD / `--preset` auto-detect /
`--lang` `en`. Projects can pin defaults (e.g. `--lang zh-TW` and a specific preset) by checking in a `config.sh` next to the script in their fork.

## Mode selection (Claude's decision tree)

When the user types `/deploy-list <date> <author> [tag]<description>` without `--anchor` or
`--deploy-commits`, **default to anchor mode**:

1. **Build anchor string**: `"<DATE> <AUTHOR> <TAG><DESCRIPTION>"` with `[tag]` joined
   directly to the description with **no separating whitespace**, matching the in-code
   marker convention. **Strip any leading whitespace** the user may have typed between
   `]` and the description — that's a typing convenience, not part of the anchor.
   - Example A (user typed without space): `/deploy-list 2026/02/09 paul [project-alpha]report search add all-option 0205`
     → anchor = `2026/02/09 paul [project-alpha]report search add all-option 0205`
   - Example B (user typed with space): `/deploy-list 2026/02/09 paul [project-alpha] report search add all-option 0205`
     → anchor = `2026/02/09 paul [project-alpha]report search add all-option 0205` (space stripped)
2. **Probe with rg first**: `rg -l --fixed-strings "<anchor>" -g '!.git' -g '!node_modules' -g '!**/tests/coverage/html/**' -g '!**/attachments/**' -g '!.claude/**'`
3. **If probe returns ≥ 1 file** → invoke the script with `--anchor "<anchor>"`. **Done.**
4. **If probe returns 0 files** → tell the user "anchor `<string>` not found in source tree; the anchor string may be incorrect or the feature is not yet implemented. Please: (a) provide `--deploy-commits SHA,...`, or (b) correct the anchor and retry". Do NOT silently fall back to base..head diff (that's how the historical "63-file" over-collection bug happens).
5. **If user explicitly passes `--deploy-commits` or `--anchor`** → respect their choice, skip the probe.

## Grouping behavior

| Condition | Main group | Warning group |
|-----------|------------|---------------|
| `--anchor` given | source files containing the literal anchor string (rg --fixed-strings) | (none) |
| `--deploy-commits` given | union diff of those commits | base..head extras |
| neither given | base..head full diff (single main group) | (none) |

tag does **not** participate in grouping. This is intentional — tag is operational metadata
(customer code / version / asset bundle) and is not written into commit messages, so
grep-on-tag historically had ~100% fallback rate. The recommended convention is to write
the full `<date> <author> <tag><desc>` string as an in-code marker (start/end block or
docblock); anchor mode finds those markers.

## Preset behavior

When `--preset` is omitted, the script:

1. Loads `$DEFAULT_PRESET` from `config.sh` if set
2. Otherwise auto-detects (Yii / Laravel / Node / Python / generic — see SKILL.md)
3. Always falls back to `generic` with a stderr note

Passing `--preset` explicitly is recommended in CI to make output deterministic regardless
of repo state.

## Execution

After parsing, invoke:

```bash
bash "$(git rev-parse --show-toplevel)/.claude/skills/deploy-list/scripts/deploy-list.sh" \
  --date "DATE" \
  --author "AUTHOR" \
  --tag "TAG" \
  --description "DESCRIPTION" \
  --project "PROJECT" \
  --base "BASE" \
  --head "HEAD" \
  --preset "PRESET" \                    # omit if not specified — script will resolve
  --lang "LANG" \                        # omit if not specified
  --anchor "ANCHOR" \                    # for anchor mode (mutually exclusive with --deploy-commits)
  --deploy-commits "DEPLOY_COMMITS_CSV"  # omit if not specified
```

(Resolution order for the script path: project's local `.claude/skills/deploy-list/` first; fall back to `${CLAUDE_PLUGIN_ROOT}/skills/deploy-list/scripts/deploy-list.sh` if the project hasn't vendored it.)

Pass script's complete stdout to the user. Do not edit, summarize, reorder, or add commentary.

## Troubleshooting (when rg probe or script fails)

| Symptom | Root cause | Action |
|---|---|---|
| rg returns 0 hits | bash variable expansion mangling non-ASCII chars | Call rg with a literal quoted string, not via `$VAR` expansion |
| rg > 60s no response | `--no-ignore` was added, scanning runtime / coverage / large vendored dirs | Drop `--no-ignore`; use the `-g '!...'` excludes in §Mode selection step 2 |
| anchor does not match source marker | String mismatch (whitespace, full-width vs half-width chars) | Stop and report to user; ask them to fix the anchor or pass `--deploy-commits` |
| Script exit ≠ 0 | Missing flag, commit not found, preset inapplicable | Pass script stderr through verbatim, do NOT try to "patch" the output |

**HARD RULE**: when the probe or script fails, **never** manually assemble schema=v1
output with Write/Edit (~5× token cost, easy to break the schema contract, no golden
verification). Correct action: report to user that the anchor was not found or the
script exited with code N, and ask them to fix the anchor, pass `--deploy-commits SHA,...`,
or explicitly switch to fallback mode (`--base X --head Y`).

## Examples

```
# Anchor mode (default when neither --anchor nor --deploy-commits supplied)
/deploy-list 2026/02/09 paul [project-alpha]report search add all-option 0205
# → Claude builds anchor, probes with rg, finds N source files, invokes script with --anchor

# Explicit anchor mode (skip the auto-probe; --anchor value must match the in-code
# marker exactly — including no whitespace between `]` and description)
/deploy-list 2026/02/26 paul [project-beta] payment sort order 0210 --anchor "2026/02/26 paul [project-beta]payment sort order 0210"

# Pinned mode (operator-supplied SHAs)
/deploy-list 2026/05/14 paul [project-gamma] tablet ordering remark dropdown --deploy-commits da5563a2
/deploy-list [V1] getReportTemplate + facility close --deploy-commits 3e16af13,c43bd436

# Fallback mode (whole base..head; risky — only when the whole range really is the feature)
/deploy-list [v1] zpos refactor split files 0515 --base master --head develop

# Non-Yii presets
/deploy-list [REL-1] Q1 feature batch --preset laravel --base main
/deploy-list [v2.3] migration drop --preset node --lang en --deploy-commits abc1234,def5678
```
