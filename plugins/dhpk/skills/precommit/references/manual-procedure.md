# Precommit — Manual Procedure

Use this fallback when `scripts/precommit-runner.js` is absent (such as in the
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

## Stage: lint_fix

1. Check `--fast` vs `full` mode and `--dry-run` before running any command.
2. Discover lint configuration:
   - If `precommit.config.json` exists at repo root, validate JSON shape
     (`stages` object with only `lint_fix`, `build`, `test_unit` keys, non-empty
     arrays, valid relative `cwd` directories inside the repository) and read
     `stages.lint_fix`.
   - Else inspect `package.json` `scripts` (`lint:fix`, or fallback lint script)
     and detect the package manager from lockfiles (`pnpm-lock.yaml` → `pnpm`,
     `yarn.lock` → `yarn`, `package-lock.json` → `npm`).
3. If `--dry-run`, print planned commands and working directories only (no stage
   execution) and mark execution stages `NOT_RUN`.
4. Otherwise run every configured `lint_fix` command in order; stop on failure
   if configured, record exit code and summary output, or mark `SKIPPED` when
   no `lint_fix` script is defined.

## Stage: build

1. In `--fast` mode, skip this stage cleanly and record `build: SKIPPED (fast mode)`.
2. In `full` mode, run every command in `precommit.config.json` `stages.build`
   (or root `package.json` `scripts.build` if no `precommit.config.json` exists)
   from its declared working directory.
3. Record exact exit code (`PASS` if 0, `FAIL` if non-zero, `SKIPPED` only if no
   build command exists, or `NOT_RUN` if aborted early).

## Stage: test_unit

1. Run configured `stages.test_unit` entries in `precommit.config.json`, or in
   `package.json` order resolve `test:unit` / `test:js` / `test` cleanly (no
   fallback to `package.json` when `precommit.config.json` is authoritative).
2. If neither `precommit.config.json` nor `package.json` provides any runnable
   command across all stages (or not inside a Git repo), stop with verdict
   `UNSUPPORTED`.
3. Inspect `git status --porcelain=v1` / `git diff --name-only` for any files
   changed by `lint_fix`, report each stage individually (`PASS` / `FAIL` /
   `SKIPPED` / `NOT_RUN`), state `mode: manual`, and return overall `PASS` only
   when every required stage ran and exited `0` (never return overall `PASS` if
   any required stage is `NOT_RUN` or `FAIL`).
