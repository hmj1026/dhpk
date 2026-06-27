## ADDED Requirements

### Requirement: Plugin ships generic role-based agents

The plugin SHALL ship 12 role-based agents under `agents/` (plus a non-invocable `INDEX.md` navigation file). All agents have generic names without project suffixes:

`architect`, `code-reviewer`, `database-reviewer`, `doc-updater`, `docs-lookup`, `harness-optimizer`, `harness-reviser`, `performance-analyzer`, `refactor-cleaner`, `security-reviewer`, `tdd-guide`, `ui-ux-verifier`.

> **v0.16.0 update:** `harness-optimizer` was removed — its broader reliability/cost/throughput scoring folded into `/harness-govern`'s conform step. The `context-budget` skill listed further below was renamed `harness-budget`. The enumerations in this bootstrap spec are preserved as the v0.1.0 snapshot; the live agent/skill roster is `plugin.json` + `agents/INDEX.md`.

#### Scenario: Agent discovery after install

- **WHEN** the plugin is installed and the user opens `/agents`
- **THEN** all 12 agents appear under the `dhpk:` namespace

#### Scenario: Agent frontmatter has no project suffix

- **WHEN** any agent file's `name:` frontmatter is read
- **THEN** the value is a generic role name with no `-zdpos_dev` (or any other project) suffix

### Requirement: Plugin ships generic commands

The plugin SHALL ship approximately 60 generic command markdown files under `commands/`, plus a non-invocable `INDEX.md` and 10 OpenSpec wrappers under `commands/opsx/`. The set covers at minimum: codex review/architect/explain/security family (`codex-*`), code exploration (`code-explore`, `code-investigate`), code review (`code-review`), creation helpers (`create-pr`, `create-skill`, `create-request`, `create-dev`), feature workflow (`feature-dev`, `feature-verify`), PR workflow (`pr-review`, `pr-summary`), precommit (`precommit`, `precommit-fast`), project setup (`project-audit`, `project-brief`, `project-setup`), git workflow (`git-investigate`, `git-worktree`, `smart-commit`), harness maintenance (`harness-audit`, `harness-revise`), docs (`doc-refactor`, `update-docs`, `update-codemaps`).

#### Scenario: Commands list does not reference project-specific agents by name

- **WHEN** any command file is grepped for `-zdpos_dev`
- **THEN** no match is found (any agent reference uses generic role names that the configurable `review_agents` userConfig can override)

### Requirement: Plugin ships generic skills (core, NOT module skills)

The plugin SHALL ship approximately 60 skill directories under `skills/` (NOT counting module-scoped skills under `modules/<name>/skills/`). Each contains a `SKILL.md`. At minimum the set includes:

- 10 `openspec-*` skills (from the dhpk scaffold)
- 7 `codex-*` skills
- All generic workflow skills: `adaptive-dev-workflow`, `agent-architecture-audit`, `bug-fix`, `bug-investigation`, `claude-health`, `code-explore`, `code-investigate`, `context-budget`, `continuous-learning-v2`, `contract-decode`, `create-request`, `de-ai-flavor`, `deploy-list`, `doc-review`, `feasibility-study`, `feature-dev`, `feature-verify`, `gemini-commit`, `git-investigate`, `git-smart-commit`, `gitnexus`, `harness-revise`, `issue-analyze`, `multi-ai-sync`, `next-step`, `op-session`, `opsx-load-context`, `opsx-post-obs`, `post-dev-test`, `pr-review`, `project-audit`, `project-setup`, `repo-intake`, `risk-assess`, `rules-distill`, `security-review`, `skill-health-check`, `skill-judge`, `skill-scout`, `skill-stocktake`, `software-architecture`, `tech-spec`, `test-review`
- Two NEW rules-as-skills: `tool-routing` and `dhpk-execution-policy`

#### Scenario: harness-revise is a real directory, not a symlink

- **WHEN** `ls -l skills/harness-revise/SKILL.md` is run on the plugin source
- **THEN** the file is a regular file (the symlink to `.agents/skills/harness-revise/` was dereferenced at copy time)

#### Scenario: Skills validate frontmatter strict-mode

- **WHEN** `claude plugin validate /home/paul/projects/dhpk/plugins/dhpk --strict` is run
- **THEN** no skill is reported with a frontmatter YAML parse error (description values containing colons/brackets/angle brackets are single-quoted)

### Requirement: tool-routing and dhpk-execution-policy ship as skills (NOT rules)

Because Claude Code's plugin spec has no `rules` component (project-local `.claude/rules/*.md` is the only path for auto-loaded rules), former rule content SHALL ship as skills with long, trigger-keyword-rich `description:` frontmatter.

- `skills/tool-routing/SKILL.md` carries the cx/gitnexus/claude-mem decision tree. Body refers to `references/decision-tree.md` for detail.
- `skills/dhpk-execution-policy/SKILL.md` carries task modes, skill priority, mandatory post-edit steps, anti-loop, output shape. Body refers to `references/{task-modes,anti-loop,output-shape,squash-merge-hygiene}.md`.

Both skills' `description:` SHALL include trigger keywords that match likely user phrasing for the skill's domain (e.g. "where is X defined", "how should I approach this").

#### Scenario: tool-routing skill is discoverable and invocable

- **WHEN** the plugin is installed and the user asks "where is the AuthService class defined"
- **THEN** Claude considers invoking the `dhpk:tool-routing` skill based on its description's trigger keywords

#### Scenario: References resolve at plugin root

- **WHEN** the user inspects `skills/tool-routing/references/decision-tree.md`
- **THEN** the file exists and is readable (paths use plugin-relative form, not absolute)

### Requirement: Plugin ships harness utility scripts

The plugin SHALL ship under `scripts/` the following harness utilities, with no zdpos-specific paths embedded:

- `codemaps/generate.ts` — codemap generator
- `lib/utils.js` — shared utilities
- `opsx-apply-resume/*.sh` — 4 OpenSpec apply-resume helper scripts
- `validate/validate-harness.sh` — harness layout validator
- `gemini-adapt-agents.js` — adapts agent definitions to Gemini/Codex
- `harness-audit.js` — deterministic audit + scorecard
- `precommit-runner.js` — precommit dispatcher (auto-detects yarn/pnpm/npm)
- `verify-runner.js` — verification loop runner
- `dep-audit.sh` — dependency security audit helper
- `statusline/statusline.sh` — opt-in statusline (project wires via settings.json)

#### Scenario: Scripts do not crash on a non-PHP project

- **WHEN** any script is run from a Node.js or Python project
- **THEN** the script either runs successfully OR emits a clear warning and exits 0 — it does NOT abort because of a missing PHP-specific resource

### Requirement: Subagent prompt template ships in docs/

The plugin SHALL ship `docs/subagent-prompt-template.md` containing the source-reading boilerplate (always include) and DB-access boilerplate (include when the task touches a table). The template is referenced from `skills/tool-routing/SKILL.md` and from sub-agent prompts written by other agents.

#### Scenario: Template is readable from plugin root

- **WHEN** `cat "${CLAUDE_PLUGIN_ROOT}/docs/subagent-prompt-template.md"` is run inside a hook subprocess
- **THEN** the file resolves and contains both the source-reading and DB-access blocks
