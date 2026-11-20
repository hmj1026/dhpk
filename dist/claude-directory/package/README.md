# dhpk-lite (Instruction-only Directory Plugin)

`dhpk-lite` is the instruction-only distribution of DHPK for Anthropic's Claude plugin directory.
It provides portable workflow skills (invoked as `/dhpk-lite:<skill-name>`), specialist agents (`dhpk-lite:<agent-name>`),
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

## What `dhpk-lite` lacks compared to the Full Plugin (`dhpk`)

- **No hooks (`hooks/hooks.json`)**: no `PreToolUse` `.env`/`.git`/credential guards, no `SessionStart` notice, and no `SubagentStop` verification hook.
- **No shipped scripts or `userConfig`**: omits `scripts/`, `skills/**/scripts/`, `manifests/`, and interactive `userConfig` settings.
- **Omitted script-dependent skills**: `flow-guide`, `git-smart-commit`, `harness-setup`, `precommit`, `release-creator`, and `opsx-apply-resume`.
- **Omitted external CLI agents**: `codex-worker`, `codex-reasoner`, and `agy-worker`.
- **Reduced frontmatter**: skills keep only `name` and `description` (routing data is packaged in `skill-next-map.json`), and agents keep only `name`, `description`, `model`, `color`, and `tools`. Skills lose `disable-model-invocation`, `argument-hint`, and `allowed-tools`.

## Install the Full Plugin (`dhpk`) and `dhpk-stacks`

If you want command hooks, local safety gates, `harness-setup`, `precommit`, `git-smart-commit`, or stack modules (`dhpk-stacks`),
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
