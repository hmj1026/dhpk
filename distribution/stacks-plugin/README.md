# dhpk-stacks

dhpk-stacks adds stack modules to the dhpk development harness for Claude Code: PHP, Yii, PHPUnit, Laravel, JavaScript, Python, React, Next.js, and iOS/Swift hooks, references, and reviewers. It is a second plugin in the same marketplace as the dhpk core plugin and requires it.

Requires Claude Code 2.1.295 or newer, and the dhpk core plugin. Claude Code installs the core plugin for you when you install dhpk-stacks, because this plugin declares it as a dependency.

## Install

```text
/plugin marketplace add hmj1026/dhpk
/plugin install dhpk-stacks@dhpk
```

Then pick the stacks your project uses in the `modules` setting of dhpk-stacks, for example `js,python` or `php-7.4,laravel-11,phpunit-11`. No module is active until you select it.

## Coming from dhpk 0.78 or earlier

Stack modules used to ship inside the core plugin and the `modules` setting lived in the core plugin. Both moved here.

1. Install dhpk-stacks as shown above.
2. Copy your old `modules` value to the dhpk-stacks plugin settings. In a project override, move `pluginConfigs["dhpk@dhpk"].options.modules` to `pluginConfigs["dhpk-stacks@dhpk"].options.modules`. A leftover `dhpk@dhpk` value is still read as a fallback, so nothing breaks while you move it.
3. Move the module tool settings too: `js_lint_script`, `js_typecheck_script`, `js_check_path`, `js_frontend_roots`, `js_core_files`, `js_vendor_globs`, `python_project_roots`, `python_runner`, `ruff_bin`, `python_typechecker`, `pyright_bin`, `mypy_bin`, `xcode_scheme`, `xcode_destination`, `swift_build_skip_tests`, `php_cs_fixer_bin`, `phpstan_bin`, and `psalm_bin`.

Run `/dhpk:setup` in your project. It detects your stack and tells you when dhpk-stacks is missing.

## What this plugin installs

- Stack modules under `modules/`. They are inactive until the `modules` setting selects them.
- Two hooks in `hooks/hooks.json`, both local shell scripts that send nothing over the network.

| Event | Matcher | Script | Purpose |
| --- | --- | --- | --- |
| PreToolUse | Bash | `stacks-pre-bash-dispatch.sh` | Runs the pre-commit lint, type-check, and build gates of the enabled modules before a `git commit`. Does nothing when no module is enabled. |
| SessionStart | all | `stacks-session-start.sh` | Checks that each enabled module exists and prints one line per enabled module. Takes no snapshots and inspects no project files. |

- The `polyfill-reviewer` agent and the `/ts-check-status` command.

## External tools

Modules call their own toolchains only when you select them, for example `php-cs-fixer`, `phpstan`, `psalm`, `eslint`, `ruff`, `pyright`, `mypy`, `swiftlint`, and `xcodebuild`. A gate skips itself when its tool is absent.

## Support and license

Source and issues: https://github.com/hmj1026/dhpk. Licensed under MIT; see `LICENSE`.
