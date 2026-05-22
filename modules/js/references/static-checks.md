# JS static-check defence — SSOT index

When the dhpk `js` module is enabled, this index orients you to the lint /
typecheck infrastructure. Each numbered link points at deeper detail.

## Toolchain

| Tool | Config file | npm script (default) | CI gate |
|---|---|---|---|
| ESLint 9 flat config | `eslint.config.js` | `npm run lint` | enforce in CI on the lint job |
| TypeScript (`noEmit`) | `tsconfig.json` | `npm run typecheck` | enforce in CI on the lint job |

Override the npm script names per project via:

- `CLAUDE_PLUGIN_OPTION_JS_LINT_SCRIPT` (default `lint`)
- `CLAUDE_PLUGIN_OPTION_JS_TYPECHECK_SCRIPT` (default `typecheck`)

## Edit-time and commit-time feedback

| Stage | Hook | Behaviour |
|---|---|---|
| After a JS/TS edit | `modules/js/hooks/post-edit-js-lint.sh` (async PostToolUse) | Runs `npx eslint <file>` on `frontend` tier; stderr surfaces the first 5 findings. Silent skip if `npx` or `eslint.config.js` are missing. |
| Before `git commit` | `modules/js/hooks/pre-commit-js-validation.sh` (PreToolUse Bash) | Runs `npm run <lint>` + `npm run <typecheck>` when the staged diff includes `frontend` tier files. Exit 2 rejects the commit. `[skip-js-lint]` in the commit message bypasses. |

Both hooks consume the same tier detector: `modules/js/hooks/_lib/js-tier-detect.sh`.

## Hook-side tier detector

`detect_js_tier <relative-path>` returns `frontend`, `vendor`, or `non-js`.
Configuration lives in `modules/js/module.yaml` under the `js:` block:

- `frontend_roots` — directories scanned for JS/TS source (default `[js,
  src]`).
- `core_files` — root-level entry-point bundles in a frontend root that
  should still lint as `frontend` (default empty; populate for legacy
  monolith projects).
- `vendor_globs` — path prefixes treated as `vendor` (default empty;
  populate with vendored libraries you don't own).

**Parity rule.** Anything you add to ESLint's Global ignores should also
land in `vendor_globs`, and any new core entry bundle should land in
`core_files`. Drift between them causes false-positive lint runs on
ignored files.

## Progressive-loaded references

| When… | Skill |
|---|---|
| Editing `eslint.config.js`, designing AST selectors, syncing the legacy-globals whitelist across ESLint / `.d.ts` / `jsdoc-globals.js`, interpreting tier 1.5 / 1.7 exemptions, measuring rollout progress | `modules/js/skills/js-lint-config/SKILL.md` |
| Planning a per-leaf cleanup, classifying a leaf as typedef-widening-fixable vs permanent-exclude, editing `tsconfig.json`'s `exclude` list, validating the strict `checkJs` exit gate | `modules/js/skills/js-static-check-strategy/SKILL.md` |
| `frontend-reviewer` agent auditing a JS/TS diff for SSOT-facade adherence and tier consistency | `modules/js/references/frontend-review-patterns.md` |

## Related command

- `/ts-check-status` — renders the `// @ts-check` / `// @ts-nocheck` /
  unmarked distribution for the configured frontend root.
