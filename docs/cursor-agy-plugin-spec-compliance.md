# Cursor and AGY plugin specification compliance (research for #1511)

Parent: #1491. Consumer: #1512 (conformance checks). Research date: 2026-11-18.
> Update 2026-11-19: the rows below that mention `commands/` or 20 command
> forwarders (C-03 to C-06, C-10, C-19) are superseded. #1491 removed all slash
> commands (changelog fragments `BREAKING.commands-to-skills` and
> `BREAKING.drop-same-name-command-forwarders`), the repository has no
> `commands/` source directory, and `scripts/lib/cursor-plugin-package.js` emits
> a `commands` component only when that source has files, so the Cursor package
> ships none. `manifests/distribution-inventory.json` still lists `commands/` as
> a `source_paths` entry for the Cursor surfaces; that listing is stale metadata
> and does not add files. The rows are kept as the 2026-11-18 record.

Scope: `dist/on-demand/dhpk-cursor` (Cursor Plugin) and `dist/on-demand/dhpk-agy` (AGY / Antigravity CLI plugin) at the
head of `feature/1491-published-packages` (package version 0.78.0).

Method and limits. Primary sources only (vendor documentation). Pages were retrieved with WebFetch; text in
quotation marks is the text returned for the page, and an item marked `(paraphrase)` was summarized by the
fetch tool, not quoted. Re-confirm quotes against the live page before using them as a CI fixture.
Anything that no vendor page states is marked UNVERIFIED. Third-party blogs and community repositories were
not used as evidence.

## Sources

| Id | URL |
| --- | --- |
| S1 | https://cursor.com/docs/plugins |
| S2 | https://cursor.com/docs/plugins/building |
| S3 | https://cursor.com/docs/subagents |
| S4 | https://cursor.com/docs/hooks |
| S5 | https://antigravity.google/docs/build-plugins/ |
| S6 | https://antigravity.google/schemas/v1/plugin.json (schema summary; the full JSON was not reproduced by the fetch tool) |
| S7 | https://antigravity.google/docs/plugins?tab=cli |

## Cursor rules (C-nn)

Status column: PASS, GAP, UNVERIFIED (spec silent or package intent unclear). "Check" is the test #1512 can implement.

| Id | Rule and official quote | Source | dhpk state | Status | Check |
| --- | --- | --- | --- | --- | --- |
| C-01 | Manifest at `.cursor-plugin/plugin.json`: "A Cursor Plugin is a directory with a manifest at `.cursor-plugin/plugin.json`." Agent Plugins use root `plugin.json` instead. | S2 | `dist/on-demand/dhpk-cursor/.cursor-plugin/plugin.json` exists | PASS | file exists; no root `plugin.json` in the cursor package |
| C-02 | `name` required: "Lowercase, kebab-case (alphanumerics, hyphens, and periods). Must start and end with an alphanumeric character." | S2 | `dhpk-cursor` | PASS | regex `^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$` |
| C-03 | Optional fields are `description, version (semver), author{name,email?}, homepage, repository, license, keywords, logo, rules, agents, skills, commands, hooks, mcpServers, variables`. | S2 | uses name, version, description, author, homepage, repository, license, keywords, rules, agents, commands, hooks, variables; no unknown keys | PASS | every top-level key is in the allowlist; `version` is semver |
| C-04 | Path fields: "All paths in manifest are relative and valid (no `..`, no absolute paths)." | S2 | `./rules/ ./agents/ ./commands/ ./hooks/hooks.json` | PASS | each path resolves inside the package root and exists |
| C-05 | A set path field "replaces folder discovery for that component" (S2: "it **replaces** folder discovery"). | S2 | rules/agents/commands/hooks set explicitly; `skills` not set and no `skills/` dir | PASS (see C-06) | if a path field is set, every file in that component dir is intended to load |
| C-06 | `skills/<name>/SKILL.md` with frontmatter `name`, `description`. | S2 | Cursor package has no `skills/`; its 20 `commands/*.md` are forwarders to `https://github.com/hmj1026/dhpk/blob/main/skills/<id>/SKILL.md` (a remote, unpinned `main` URL). Skills ship only in the sibling Agent Plugin (`dist/on-demand/dhpk-agent`). | GAP (design) | decide whether Cursor must ship skills in-package; flag any command whose only body is a remote `main` URL |
| C-07 | Rules: `.mdc` in `rules/` with frontmatter `description`, `alwaysApply` (boolean), `globs`. | S2 | 6 `.mdc` files; each has `description` and `alwaysApply` (1 true, 5 false); none has `globs` | PASS (whether `globs` is required for `alwaysApply: false` is UNVERIFIED) | frontmatter parses; `alwaysApply` is boolean |
| C-08 | Agents: `.md/.mdc/.markdown` in `agents/` with `name`, `description`. Subagent fields: name, description, model, readonly, is_background; `name` should use "lowercase letters and hyphens". | S2, S3 | 32 agents; all have name, description, model, readonly | PASS | `name` matches `^[a-z-]+$` and the filename stem; only the 5 documented keys |
| C-09 | `model`: `inherit` or "a specific model ID, such as `composer-2` or `gpt-5.6-sol`"; IDs are "listed in the models reference". | S3 | 28 use `cursor-grok-4.6-high`, 4 use `composer-2.5-fast` | UNVERIFIED (the models reference was not fetched; ID validity cannot be proven from the pages read) | model value is `inherit` or in a pinned allowlist taken from the models reference |
| C-10 | Commands: `.md/.mdc/.markdown/.txt`, frontmatter optional (`name`, `description`). | S2 | 20 commands with `name` and `description` | PASS | extension in allowlist |
| C-11 | Hooks: `hooks/hooks.json` with `"version": 1` ("Must be a positive integer (use `1`)") and a `hooks` object mapping documented event names to arrays of `{command}`. | S2, S4 | `{"version":1,"hooks":{}}` | PASS (valid but empty; no hooks shipped) | `version` is a positive integer; every key is in the S4 event list; every entry has `command` |
| C-12 | Plugin hooks "Run from the plugin's install directory, which `CURSOR_PLUGIN_ROOT` points to." | S4 | no hook entries | PASS (n/a) | any hook `command` is relative or uses `CURSOR_PLUGIN_ROOT` |
| C-13 | Variables: "The top level must be `{ "type": "object", "properties": { ... } }`." Every `${VAR}` used in `mcp.json` must be declared. Plugin variables are not shell `${env:...}` syntax. | S2 | `variables` is `{"type":"object","properties":{}}`; no `mcp.json` | PASS | top-level shape; if `mcp.json` exists every `${VAR}` is declared |
| C-14 | Placeholder tokens inside agent and rule prose. S2 documents `${VAR}` only for manifest-declared variables and S4 documents `CURSOR_PLUGIN_ROOT` only as the hook working directory. | S2, S4 | agents use `${CURSOR_PLUGIN_ROOT}` (83 uses), `${POLICY_BUNDLE_ROOT}` (42 uses), and `${CLAUDE_PLUGIN_ROOT}` (4 uses, in `agent-traps/_common/*`) | UNVERIFIED that Cursor expands any of these inside markdown prose; `${CLAUDE_PLUGIN_ROOT}` is a Claude token, not documented for Cursor (inference, not a quote) | grep the package for tokens; fail on `CLAUDE_PLUGIN_ROOT`; list tokens not declared in `variables` |
| C-15 | Marketplace file location: "Place it at `.cursor-plugin/marketplace.json` in the repository root." Required `name` (kebab-case), `owner{name}`, `plugins[]`; file "10 MB or smaller". Entry has `name`, `source`. Parser reads `<source>/.cursor-plugin/plugin.json`. | S2 | `marketplace.json` is inside the package (`dist/on-demand/dhpk-cursor/.cursor-plugin/marketplace.json`), `source: "."`, description "Local Cursor Plugin marketplace fixture for dhpk.". Repository root has no `.cursor-plugin/`. | GAP | repo root has `.cursor-plugin/marketplace.json` whose entry `source` is `./dist/on-demand/dhpk-cursor` and resolves to a manifest; size <= 10 MB |
| C-16 | Marketplace entry `name` must be unique; manifest values win over entry values. | S2 | entry name `dhpk-cursor` equals the manifest name; marketplace `name` is `dhpk` | PASS | entry name equals manifest name; entry names unique |
| C-17 | Submission: valid manifest; "Host the plugin in a public Git repository"; unique kebab-case name; clear description; "Include a README and test locally"; "All plugins must be open source"; "Every plugin is manually reviewed before it's listed" (S1). Submit at cursor.com/marketplace/publish. | S1, S2 | `README.md` and `README.zh-TW.md` present; MIT license in manifest; no `LICENSE` file inside the package (root `LICENSE` only) | PASS for README; per-package LICENSE requirement UNVERIFIED | `README.md` exists at package root; `license` set |
| C-18 | `logo`: relative path such as `assets/logo.svg` or an absolute URL (optional). | S2 | none | PASS (optional; whether a listing needs it is UNVERIFIED) | if `logo` set, file exists |
| C-19 | Extra top-level content. S2 lists `rules/ skills/ agents/ commands/ hooks/ mcp.json assets/ scripts/`. | S2 | package also ships `agent-traps/`, `fingerprints.json`, `provenance.json` | UNVERIFIED (spec neither allows nor forbids extra files) | informational; keep `agent-traps/` because agents reference it |

## AGY rules (A-nn)

| Id | Rule and official quote | Source | dhpk state | Status | Check |
| --- | --- | --- | --- | --- | --- |
| A-01 | Manifest location: "The manifest sits at `<plugin-root>/plugin.json`, or at `.antigravity-plugin/plugin.json`" (paraphrase of S5; S7: "`plugin.json` manifest (or `.antigravity-plugin/plugin.json`)"). | S5, S7 | `dist/on-demand/dhpk-agy/plugin.json` | PASS | file exists at package root |
| A-02 | `name` required. S5: must match `^[a-z0-9]+(-[a-z0-9]+)*$`. S6: letters, digits, hyphens, and underscores only (paraphrase). The two sources disagree. | S5, S6 | `dhpk` | PASS under both | check the stricter S5 pattern |
| A-03 | Unknown top-level manifest keys: schema sets `"additionalProperties": false`; keys are case-sensitive; a recognized key with the wrong type stops the plugin from loading (paraphrase). | S5, S6 | keys `description, name, skills, version` | PASS (all four documented: `skills` path list, `version` any string) | key allowlist from S6: name, displayName, display_name, description, version, homepage, repository, license, keywords, disabled, logo, suggestedPrompts, suggested_prompts, skills, author, extensions |
| A-04 | Marketplace publishing requires "`name`, `displayName`, `description`, `version`, `logo`, and `author`." `logo`: square, at least 128x128 px, `.svg/.png/.jpg/.jpeg/.webp`. `homepage`, `license`, `keywords` recommended. | S5 | missing `displayName`, `logo`, `author`; no `homepage`, `license`, `keywords` | GAP (blocks marketplace listing only; local install unaffected) | all six required keys present; logo file exists and is a supported type |
| A-05 | "A `README.md` at the root documents the plugin in the Marketplace"; publishing needs a complete `plugin.json`, a `README.md`, and a bundled logo (paraphrase). | S5 | no `README.md` in `dist/on-demand/dhpk-agy` | GAP (publish) | `README.md` exists at package root |
| A-06 | Validation gate: `agy plugin validate --strict ./my-plugin`; marketplace needs zero errors and no unresolved warnings on Antigravity files (paraphrase). | S5 | repo only has `bin/dhpk distribution agy-plugin validate` (own structural code); no use of `agy plugin validate`. Docs say `agy plugins list` while S5 says `agy plugin list`. | GAP | run `agy plugin validate --strict --json` on the generated package when the CLI is available; else SKIP_INCOMPATIBLE, never PASS |
| A-07 | Skills: `skills/<skill-name>/SKILL.md`; `name` kebab-case, 1-64 chars, "**must match the parent directory name**"; `description` required, 1-1,024 chars; optional `disable-model-invocation`, `license`, `compatibility`. | S5 | 14 skill dirs; names present | PASS for sampled `repo-verify`; full match not run | for each skill dir: `name == dirname`, 1-64 chars, description 1-1024 chars |
| A-08 | Unlisted skill frontmatter keys. S5 lists only name, description, disable-model-invocation, license, compatibility. | S5 | `argument-hint` (17 files) and a `metadata:` block (36 files) under `skills/` | UNVERIFIED whether validate warns or rejects (spec silent) | run A-06; until then report the key set as a warning, not a failure |
| A-09 | Skill description length limit of 1,024 chars; dhpk descriptions are long prose. | S5 | not measured | UNVERIFIED | length check in A-07 |
| A-10 | Agents: `agents/<agent-name>.md`; required `name`, `description`; optional `mainAgent`, `subagent`, `model`, `tools`, `commandExecutionPolicy`, `skills`, `inheritMcp`, `inheritCustomizations`. | S5 | 31 agents with name, description, tools, model | PASS | key allowlist; `name == filename stem` (whether S5 requires it is UNVERIFIED) |
| A-11 | `model` accepts `"inherit"`, `"flash_lite"`, `"flash"`, or `"pro"`. | S5 | 28 `pro`, 1 `flash`, 3 `flash_lite` | PASS | value in the four-item set |
| A-12 | `tools` is an allowlist of built-in tools; `send_message` always included; omitted means all tools (paraphrase). Tool names are not enumerated on the pages read. | S5 | tools used: `view_file`, `list_dir`, `grep_search`, `run_command`, `write_to_file`, `replace_file_content`, `invoke_subagent` | UNVERIFIED (no official tool-name list found; `invoke_subagent` in particular) | pin the observed names in a fixture until an official list is found |
| A-13 | S7 does not document the agent file format ("The page does not document the agent file format"); S5 is the only source. | S7 | n/a | UNVERIFIED (single source) | n/a |
| A-14 | Rules: `rules/AGENTS.md` or `rules/GEMINI.md` always on without frontmatter; named rule files use `trigger` of `always_on`, `model_decision`, `glob`, `manual`; `globs` a comma-separated string. | S5 | 5 rule files: 1 `always_on`, 4 `model_decision`, all with `description` | PASS | `trigger` in the four-item set; if `glob`, `globs` is a string |
| A-15 | Hooks in root `hooks.json`; commands run with the plugin root as working directory, so use `./scripts/...`. | S5 | no `hooks.json` | PASS (optional component absent) | if present, validate per S5 event shapes |
| A-16 | MCP in `mcp_config.json` with `mcpServers`; `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` expand in `args`, `cwd`, `env`. | S5 | none | PASS (absent) | n/a |
| A-17 | Install path: S5 "~/.gemini/config/plugins/<plugin-name>"; S7 "Global level: Place your plugin folder in `~/.gemini/config/plugins/`" and workspace `.agents/plugins/`. | S5, S7 | `scripts/lib/agy-path-contract.js` and `docs/agy-subagent-plugin-guide.md` treat `~/.gemini/antigravity-cli/plugins/dhpk/` as canonical and the official path as "legacy candidate" | GAP (contradicts both official pages; the dhpk choice may come from observed agy behavior, which is not a primary source) | path contract equals the S5/S7 path, or a documented override with evidence |
| A-18 | Placeholder tokens in prose: S5 documents only `${PLUGIN_ROOT}` and `${PLUGIN_DATA}`, and only for `mcp_config.json`. | S5 | `${CLAUDE_PLUGIN_ROOT}` appears in `agent-traps/_common/build-resolver-skeleton.md` and `trap-sheet-loader.md` | GAP (Claude token in an AGY package; inference) | grep the package for `CLAUDE_PLUGIN_ROOT`; expect zero |
| A-19 | Extra content: `manifests/`, `scripts/`, `agent-traps/`, `fingerprints.json`, `provenance.json`, per-skill `distribution.yaml`, `references/`, `scripts/`. The spec restricts `additionalProperties` on `plugin.json` only. | S5, S6 | present | UNVERIFIED (no file-level restriction found) | informational |
| A-20 | Submission channel: partner intake form (https://forms.gle/2EX5RFYPoJe1UgxR9) per S5. | S5 | n/a | UNVERIFIED how review runs; no public-repository requirement found | n/a |

## Gap list (for #1512 prioritization)

Cursor: C-06 (no in-package skills; remote `main` command bodies), C-14 (`CLAUDE_PLUGIN_ROOT` token, undeclared tokens),
C-15 (marketplace file not at repository root; fixture description). Unverifiable: C-09, C-14 expansion, C-17 per-package LICENSE, C-19.

AGY: A-04 (displayName, logo, author), A-05 (README), A-06 (no `agy plugin validate --strict` gate),
A-17 (install path differs from official pages), A-18 (`CLAUDE_PLUGIN_ROOT`).
Unverifiable: A-08, A-09, A-12, A-13, A-19, A-20.

## Open questions for the maintainer

1. Does the `antigravity-cli/plugins` path come from observed agy behavior? If yes, record that evidence next to A-17.
2. Is a Marketplace listing for either host a goal? C-15, A-04 and A-05 only matter if yes.
3. Should the Cursor package carry skills itself (C-06)?

## Conformance coverage (#1512)

`scripts/lib/publication-conformance.js` (`checkCursorPlugin`, `checkAgyPlugin`) runs the basic structural rules on the
on-demand builds; `scripts/ci/verify-platform-packages.js` runs it for each built Cursor and AGY package, and the release
package gate calls that verifier. Error messages carry the rule id.

Checked: C-01 to C-04, C-07, C-08, C-10 to C-14 (Claude token only), C-16, C-17 (README and `license`), A-01 to A-03, A-07,
A-10, A-11, A-14, A-18, plus manifest version equal to `package.json`. C-08 allows digits in the agent name because the
canonical `e2e-runner` has one.

Documented gaps, not checked: C-15, A-04, A-05 (marketplace listing only); C-06 (Cursor shipping its own skills, out of scope);
A-17 (install path, UNVERIFIED); C-09, C-12 beyond absolute paths, A-06, A-08, A-09, A-12, A-13, A-19, A-20 (UNVERIFIED or need
the vendor CLI).

Build fixes made for these rules: the Cursor and AGY `agent-traps/_common/*` support files no longer contain
`${CLAUDE_PLUGIN_ROOT}` (C-14, A-18). Cursor rewrites it to `${CURSOR_PLUGIN_ROOT}` (and `rules/execution-policy.md` to `.mdc`);
AGY rewrites it to the documented `${PLUGIN_ROOT}` and relative paths.
