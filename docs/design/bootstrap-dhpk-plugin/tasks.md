## 1. Plugin skeleton + manifest

- [x] 1.1 Create `.claude-plugin/marketplace.json` (root) as one-entry catalog
- [x] 1.2 Create `plugins/dhpk/.claude-plugin/plugin.json` with userConfig (`hook_profile`, `review_agents`, `docker_containers`, `modules`, `review_trigger_extra_paths`)
- [x] 1.3 Create plugin directory tree: `agents/`, `commands/`, `skills/`, `modules/`, `hooks/`, `scripts/hooks/_lib/`, `scripts/statusline/`, `docs/`, `codex/`
- [x] 1.4 Move `dhpk/.claude/skills/openspec-*` (10 dirs) → `plugins/dhpk/skills/`
- [x] 1.5 Move `dhpk/.claude/commands/opsx/` (10 files) → `plugins/dhpk/commands/opsx/`
- [x] 1.6 Remove now-empty `dhpk/.claude/` scaffold
- [x] 1.7 Create `.gitignore` excluding `.claude/artifacts/`, `.claude/worktrees/`, `node_modules/`, `*.log`
- [x] 1.8 `claude plugin validate ~/projects/dhpk --strict` AND `claude plugin validate ~/projects/dhpk/plugins/dhpk --strict` both pass

## 2. Hook scripts and harness scripts

- [x] 2.1 Write `scripts/hooks/_lib/payload.sh` (parameterised arrays + `extract_tool_input` helper)
- [x] 2.2 Write `scripts/hooks/pre-edit-guard.sh` (block .env, .git/)
- [x] 2.3 Write `scripts/hooks/pre-bash-guard.sh` (rm -rf, curl|sh, chmod 777/666, push-with-sentinels)
- [x] 2.4 Write `scripts/hooks/post-write-crlf-fix.sh` (WSL CRLF normaliser, async)
- [x] 2.5 Write `scripts/hooks/post-edit-remind.sh` (file-ext defaults + module triggers + user extra-paths, with embedded Python YAML parser)
- [x] 2.6 Write `scripts/hooks/stop-review-reminder.sh` (parameterised agent names, hook_profile=minimal suppression)
- [x] 2.7 Write `scripts/hooks/clear-sentinel.sh` (parametric, --all, unknown-name fail-fast)
- [x] 2.8 Write `scripts/hooks/session-start.sh` (artifact dirs, docker-loop, module activation, DHPK_ACTIVE_MODULES export)
- [x] 2.9 Write `scripts/hooks/install-codex-skills.sh` (symlink default, --copy, --update, --force, project-root heuristic, .dhpk-installed.json manifest)
- [x] 2.10 Write `hooks/hooks.json` (PreToolUse Edit/Bash, PostToolUse Edit + async crlf, SessionStart, Stop)
- [x] 2.11 Write `scripts/statusline/statusline.sh` (parameterised docker, modules, sentinel badge; calls global statusline as base)
- [x] 2.12 Copy `codemaps/`, `lib/`, `opsx-apply-resume/`, `validate/`, 4 `*.js` scripts, `dep-audit.sh` from source
- [x] 2.13 `chmod +x` all `*.sh` scripts
- [x] 2.14 Smoke-test: source `payload.sh` confirms `SENTINEL_AGENTS` overrides via `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS`

## 3. Agents (12 generic role-based)

- [x] 3.1 Copy 5 already-generic agents (`doc-updater`, `docs-lookup`, `harness-optimizer`, `harness-reviser`, `INDEX.md`) — *(`harness-optimizer` removed in v0.16.0; folded into `/harness-govern` conform)*
- [x] 3.2 Copy 8 `-zdpos_dev` agents under their generic names (`architect`, `code-reviewer`, `database-reviewer`, `performance-analyzer`, `refactor-cleaner`, `security-reviewer`, `tdd-guide`, `ui-ux-verifier`)
- [x] 3.3 sed-strip `-zdpos_dev` suffix from frontmatter `name:` and from cross-references in both agents and commands
- [x] 3.4 Rewrite `agents/INDEX.md` to a plugin-namespaced agent list (no `-zdpos_dev` references)
- [ ] 3.5 **DEFERRED to v0.2**: rewrite remaining PHP/Yii body examples in 7 agents (functional in v0.1.0; cosmetic for non-PHP projects)

## 4. Core skills (~60) + new rules-as-skills

- [x] 4.1 Bulk-copy all generic skills from source, excluding `openspec-*` (already moved), `zdpos-*` (project-specific), `harness-revise` (symlink — separate handling)
- [x] 4.2 Resolve `harness-revise` symlink to a real directory by following the target
- [x] 4.3 Write `skills/tool-routing/SKILL.md` + `references/decision-tree.md` (carries former rules/tool-routing.md content)
- [x] 4.4 Write `skills/dhpk-execution-policy/SKILL.md` + `references/{task-modes,anti-loop,output-shape,squash-merge-hygiene}.md`
- [x] 4.5 Python pass: single-quote frontmatter values containing colons/brackets/angle brackets (fixes YAML strict-mode validation)

## 5. Commands (~68)

- [x] 5.1 Bulk-copy commands from source, excluding `de-ai-flavor.md`, `ui-ux-verify.md`, `yii1-security-audit.md`, `deploy-list.md`
- [x] 5.2 sed-strip `-zdpos_dev` agent references in 5 mixed commands
- [x] 5.3 Rewrite `commands/INDEX.md` to plugin-namespaced command list with frontmatter
- [x] 5.4 Add minimal frontmatter to `commands/harness-audit.md` (was missing)
- [x] 5.5 Stash `yii1-security-audit.md` for placement in yii-1.1 module

## 6. docs/

- [x] 6.1 Write `docs/subagent-prompt-template.md` (source-reading + DB-access boilerplate)

## 7. Modules (3 stack modules)

- [x] 7a.1 `modules/php-5.6/`: move `php-pro` skill from `skills/`, copy `rules/php/coding-style.md` to `references/`, write `module.yaml`
- [x] 7b.1 `modules/yii-1.1/`: move `php56-yii-dev`, `yii1-security-audit` from `skills/`, copy `rules/php/{yii-framework,patterns,security}.md` as `references/{framework,patterns,security}.md`, write `module.yaml` with `requires: [php-5.6]`
- [x] 7c.1 `modules/phpunit-5.7/`: move `phpunit-batch-refactor`, `legacy-code-characterization` from `skills/`, copy `rules/php/testing.md` to `references/`, write `module.yaml` with `requires: [php-5.6]`
- [x] 7.2 Sanitise external paths in references: `~/projects/yii_framework/` → `<YII_FRAMEWORK_PATH>`; `protected/tests/docs/TESTING_STANDARDS.md` → `<PROJECT_TEST_STANDARDS>`
- [x] 7.3 Update `plugin.json` `skills` array to include all three module skill paths
- [x] 7.4 Re-validate after module additions

## 8. Codex dual-track

- [x] 8.1 Copy `zdpos_dev/.codex/skills/` (38 entries) → `plugins/dhpk/codex/skills/`
- [x] 8.2 Copy `zdpos_dev/.codex/agents/` (19 entries) → `plugins/dhpk/codex/agents/`
- [x] 8.3 Copy + sanitise `zdpos_dev/.codex/config.toml` → `plugins/dhpk/codex/config.toml.example` (replace project paths with placeholders)
- [x] 8.4 Write `plugins/dhpk/codex/README.md` (install flow, symlink vs copy, idempotency, post-update step)

## 9. Top-level docs

- [x] 9.1 Write `README.md` (install, userConfig table, modules walkthrough, statusline wiring, Codex sync, migration guide pointer, dev tip)
- [x] 9.2 Write `CHANGELOG.md` v0.1.0 entry (added components, known limitations, verification commands)
- [x] 9.3 Fill `openspec/config.yaml` `context:` with plugin architecture summary + coding constraints

## 10. Validate + dogfood

- [x] 10.1 `claude plugin validate ~/projects/dhpk --strict` (marketplace) passes
- [x] 10.2 `claude plugin validate ~/projects/dhpk/plugins/dhpk --strict` passes
- [x] 10.3 Hook smoke test: simulated Edit to `protected/controllers/AuthController.php` with `DHPK_ACTIVE_MODULES=yii-1.1` correctly wrote `.pending-review` AND `.pending-security-review`
- [ ] 10.4 **DEFERRED**: full marketplace add + install + manual edit in a scratch project (requires interactive session; verification commands documented in README)
- [ ] 10.5 **DEFERRED to migration change**: side-by-side install on `zdpos_dev` per the migration plan's M1–M3 phases

## 11. openspec refresh (this change's own artifacts)

- [x] 11.1 Replace `specs/php-language-module/` with `specs/modules-architecture/`
- [x] 11.2 Update `proposal.md` to capture modules architecture + plugin-rules constraint
- [x] 11.3 Update `design.md` with D8 (rules don't auto-load), D9 (module versioning), D10 (yaml schema), D11 (frontmatter quoting)
- [x] 11.4 Update `specs/plugin-manifest/spec.md` (`language_modules` → `modules`, marketplace source path)
- [x] 11.5 Update `specs/core-harness/spec.md` (drop rules requirement, add `tool-routing` + `dhpk-execution-policy` skills, drop `INDEX.md` from agent count)
- [x] 11.6 Update `specs/review-sentinel-workflow/spec.md` (cross-reference module triggers, fix English-only stderr message)
- [x] 11.7 Rewrite `tasks.md` to reflect what was actually built (this file)
