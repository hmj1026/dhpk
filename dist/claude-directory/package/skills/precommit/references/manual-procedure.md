# Precommit — Manual Procedure

Use this fallback when `packaged-precommit-runner.js` is absent (such as in the
instruction-only Directory Plugin) or cannot execute.

## Safety Rules

- Run from the consumer repository root; never invoke package runners inside an
  external plugin cache directory.
- Do not fabricate or weaken checks. Never treat `--dry-run`, skipped stages, or
  partial runs as an overall `PASS`; any required stage that did not run MUST
  be reported as `NOT_RUN`, and the overall verdict MUST NOT be `PASS`.
- Read actual configuration first (`precommit.config.json` takes strict priority
  over root `package.json`; do not fall back to `package.json` if
  `precommit.config.json` exists and fails validation or omits a stage).
- State `mode: manual` in the report alongside every stage verdict (`PASS`,
  `FAIL`, `SKIPPED`, or `NOT_RUN`).

## Preflight (before any stage)

Matches `precommit-runner.js` setup. Do this once, before `lint_fix`.

1. Confirm the directory is inside a Git repository. If not, stop with verdict
   `UNSUPPORTED`.
2. Choose the mode: `full` (default) runs `lint_fix`, `build`, `test_unit`;
   `fast` skips `build`. Note whether `--dry-run` was requested.
3. Resolve the plan for all stages now. If `precommit.config.json` exists at the
   repo root, validate it:
   - The JSON parses and has a `stages` object with only the keys `lint_fix`,
     `build`, `test_unit`.
   - Each present stage is a non-empty array of objects.
   - Each `name` matches `^[A-Za-z0-9][A-Za-z0-9._-]*$` and is unique within
     its stage.
   - `command` is a non-empty string; `args` (default `[]`) is an array of
     strings.
   - `cwd` (default `.`) is a relative path. Resolve its real path; it MUST
     exist, be a directory, and stay inside the repository real path.
   - A stage that is absent is not configured; report it as `SKIPPED`.

   Any validation error is a `FAIL`; do not fall back to `package.json`.
   Otherwise, read root `package.json` `scripts` and detect the package manager
   from lockfiles (`pnpm-lock.yaml` -> `pnpm`, `yarn.lock` -> `yarn`, else
   `npm`).
4. If the plan has zero runnable commands across all stages, stop with verdict
   `UNSUPPORTED`.
5. Capture `git status` before the run, for the report.

Run each command as its executable plus an argument list, directly and not
through a shell, in its resolved `cwd` (the repo root for package scripts).

## Stage: lint_fix

1. If `--dry-run`, print the planned command and working directory of every
   stage in order and run nothing. Mark every execution stage `NOT_RUN`; the
   overall result is never `PASS`.
2. With `precommit.config.json`, run each `stages.lint_fix` entry in order. Mark
   `SKIPPED` if the stage is not configured.
3. Without it, use only the `lint:fix` script (no other lint fallback). If it is
   absent, mark `SKIPPED`. Otherwise run the package manager's command for
   `lint:fix`. For `npm` the argument list is `run lint:fix -- --` (two `--`),
   so the command is `npm run lint:fix -- -- <arguments>`; for `yarn` and `pnpm`
   it is `lint:fix -- <arguments>` (one `--`). The arguments are:
   `--ignore-pattern 'node_modules/**' --ignore-pattern '**/node_modules/**'
   --no-error-on-unmatched-pattern 'src/**/*.{ts,tsx,js,jsx}'
   'test/**/*.{ts,tsx,js,jsx}' 'migrations/**/*.{ts,tsx,js,jsx}'
   'loadtest/**/*.{ts,tsx,js,jsx}' '*.{ts,js}'`.
   Set env `NO_UPDATE_NOTIFIER=1`.
4. For every `lint_fix` command (config or script), set env
   `XDG_CONFIG_HOME=<repo>/.claude/cache/xdg` (create the directory first,
   except in `--dry-run`, which creates nothing).
5. Record each exit code. After `lint_fix`, run `git diff --name-only` and record
   the files it changed.

## Stage: build

1. In `fast` mode, skip this stage and record `build: SKIPPED (fast mode)`.
2. If `--dry-run`, run nothing and mark `NOT_RUN`.
3. In `full` mode, run each `precommit.config.json` `stages.build` entry in
   order, or (with no config file) the root `package.json` `build` script.
4. Record each exit code (`PASS` if 0, `FAIL` if non-zero). Mark `SKIPPED` only
   if no build command exists.

## Stage: test_unit

1. If `--dry-run`, run nothing and mark `NOT_RUN`.
2. With `precommit.config.json`, run each `stages.test_unit` entry in order.
3. Without it, pick one `package.json` script in this order: `test:js`, then
   `test:unit`, then `test`. If only `test` exists, note that the fallback is in
   use. If none exists, mark `SKIPPED`.
4. Do not stop at the first failing command. The runner runs every planned step
   and reports `FAIL` at the end. Record every exit code.
5. Capture `git status` after the run and report each stage individually
   (`PASS` / `FAIL` / `SKIPPED` / `NOT_RUN`), the files changed by `lint_fix`,
   and `mode: manual`. Return overall `PASS` only when at least one step ran and
   every step that ran exited `0`, with no required stage `NOT_RUN`. Any
   non-zero exit makes the overall result `FAIL`.
