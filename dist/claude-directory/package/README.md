# dhpk-lite (Instruction-only Directory Plugin)

`dhpk-lite` is the instruction-only distribution of DHPK for Anthropic's Claude plugin directory.
It provides all 17 workflow skills (invoked as `/dhpk-lite:<skill-name>`), 27 specialist agents (`dhpk-lite:<agent-name>`),
trap sheets, and execution policy rules with zero local hooks, zero executable scripts, and zero `userConfig` prompts.

## Install `dhpk-lite`

Install `dhpk-lite` from the official Claude Plugin Directory (or another marketplace listing `dhpk-lite`):

```text
/plugin install dhpk-lite --marketplace anthropics/claude-plugins-official
```

## Keep only one enabled

Do not enable both `dhpk` (Full Plugin) and `dhpk-lite` (Directory Plugin) at the same time.
They expose the same underlying skills and agents under separate namespaces (`dhpk:` vs `dhpk-lite:`).
Keep only one active in a workspace.

## How `dhpk-lite` differs from the Full Plugin (`dhpk`)

- **No hooks (`hooks/hooks.json`)**: no `PreToolUse` `.env`/`.git`/credential guards, no `SessionStart` notice, and no `SubagentStop` verification hook.
- **No shipped scripts or `userConfig`**: omits `scripts/`, `skills/**/scripts/`, `manifests/`, `agents/INDEX.md`, and interactive `userConfig` settings.
- **Manual Procedures (`mode: manual`)**: `flow-guide`, `opsx-apply-resume`, `git-smart-commit`, `harness-setup`, `precommit`, and `release-creator` use their packaged `references/manual-procedure.md` workflows with standard tools and consumer project commands, reporting `mode: manual`.
- **Omitted external CLI agents**: `codex-worker`, `codex-reasoner`, and `agy-worker`.
- **Reduced frontmatter**: skills keep only `name` and `description` (routing data is packaged in `skill-next-map.json`), and agents keep only `name`, `description`, `model`, `color`, and `tools`. Skills lose `disable-model-invocation`, `argument-hint`, and `allowed-tools` (user-only skills carry explicit-request guards).

## What `dhpk-lite` runs and sends

`dhpk-lite` ships no code. Claude runs each command below through its normal Bash tool and permission prompts, in your project and only when a skill needs it:

- **Local Git and project commands**: read-only `git` queries, `git add` and `git commit` after you confirm, and your project's own lint, build, test, and validation commands.
- **GitHub through `git` and `gh`**: `release-creator` runs `git push`, `gh pr create`, `git tag` with a tag push, and `gh run watch`; `create-pr` opens pull requests; `proposal-analyze` reads issues with `gh issue view`. Each write runs only on your explicit request and stops for your confirmation first.
- **Your project's own endpoints**: `repo-verify` feature verification can send read-only `curl` requests to health and API endpoints that your project lists, and skips that step when no endpoint list exists.
- **Your project's release gate**: `release-creator` runs the publish or package gate script that your project names, by default under `scripts/release/` or through `DHPK_RELEASE_PUBLISH_GATE_SCRIPT` or `DHPK_RELEASE_PACKAGE_GATE_SCRIPT`.
- **Your memory tool (optional)**: `opsx-apply-resume` can save one handoff observation to a memory tool that is already connected to your session. It skips this step when no memory tool is available.

The skills name no other destination: they reach only your Git remote, GitHub through your own `gh` login, your project's endpoints, and a memory tool that you connected.

## Install the Full Plugin (`dhpk`) and `dhpk-stacks`

If you want command hooks, local safety gates, scripted runners, or stack modules (`dhpk-stacks`),
install the Full Plugin directly from the DHPK Repository Marketplace in Claude Code:

```text
/plugin marketplace add hmj1026/dhpk
/plugin install dhpk@dhpk
```

For language and framework stack modules and stack skills, also install `dhpk-stacks` (requires the Full Plugin `dhpk`):

```text
/plugin install dhpk-stacks@dhpk
```

## Support and license

Source and issues: https://github.com/hmj1026/dhpk. Licensed under MIT; see `LICENSE`.
