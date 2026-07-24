---
description: 'Verify a repository in fast or full mode with runner-first execution, deterministic stage order, and explicit PASS/FAIL/SKIP output.'
argument-hint: '[fast|full] [--integration <path>] [--e2e <path>]'
allowed-tools: 'Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(git:*), Bash(python*:*), Bash(pytest:*), Bash(ruff:*), Bash(mypy:*), Bash(cargo:*), Bash(go:*), Bash(golangci-lint:*), Bash(./gradlew:*), Bash(mvn:*), Bash(bundle:*), Read, Grep, Glob'
---

# /verify — Verification loop

Run one read-only verification loop against the current repository. Resolve
the mode first, use the installed runner when present, and report every
applicable stage as PASS, FAIL, or SKIP.

## Context

- Branch: !`git branch --show-current`
- Changes: !`git diff --stat HEAD`

## Step 1 — normalize the request

- No mode or `full` → run lint, typecheck, unit, integration, and e2e stages.
- `fast` → run lint and unit stages only.
- `--integration <path>` and `--e2e <path>` opt into one explicit test file in
  the corresponding full-mode stage.
- Accept one mode token, `fast` or `full`; report usage and stop on any other
  mode token.

Completion criterion: the mode is `fast` or `full`, and each optional test path
is either absent or attached to its matching stage.

## Step 2 — use the installed runner

Use Glob to check for `.claude/scripts/verify-runner.js` at the project root.

When found, run:

```bash
node .claude/scripts/verify-runner.js $ARGUMENTS
```

The runner owns package-manager detection, stage order, graceful skips, logs,
and the final summary. Treat its output as authoritative:

- An overall line containing `PASS` → verification passed.
- An overall line containing `FAIL` → verification failed; report the failed stage(s) and
  their log paths.
- `runner crashed`, a missing overall line, or an execution error → report a
  runner failure.

Runner failure remains terminal. Select the fallback only when the runner file
is absent.

Completion criterion: the runner output contains one overall verdict and every
executed or skipped stage is represented in that summary.

## Step 3 — fallback when the runner is absent

Detect the first matching project manifest and run the commands in stage order.
For Node.js, detect the package manager from its lockfile and read
`package.json` before choosing scripts.

| Manifest | Ecosystem | Fast | Full additions |
|---|---|---|---|
| `package.json` | Node.js | `{pm} lint`; `{pm} test:js`, then `test:unit`, then `test` | `{pm} typecheck` or local `npx --no-install tsc --noEmit`; explicit `test:integration` and `test:e2e` paths |
| `pyproject.toml` | Python | `ruff check .`; `pytest` | `mypy .` |
| `Cargo.toml` | Rust | `cargo clippy`; `cargo test` | Rust compilation/typechecking is part of these commands |
| `go.mod` | Go | `golangci-lint run`; `go test ./...` | `go vet ./...` |
| `build.gradle` or `pom.xml` | Java | project lint task when present; project test task | build/typecheck is implicit in the build or verification task |

Run available commands in this order: lint, typecheck when applicable, unit or
project test, then explicitly requested integration/e2e tests. Record a missing
script or unavailable optional tool as SKIP with the exact reason. A project
without a recognized manifest is unsupported by the fallback; report that and
stop.

For Node.js projects, use these script rules:

| Stage | Preferred script | Fallback |
|---|---|---|
| lint | `lint` | SKIP: `no lint script — skipped` |
| typecheck | `typecheck` | local `tsconfig.json` compiler, otherwise SKIP |
| unit | `test:js` | `test:unit`, then `test` |
| integration | `test:integration` | SKIP unless an explicit path is supplied |
| e2e | `test:e2e` | SKIP unless an explicit path is supplied |

Completion criterion: one fallback ecosystem is selected, every applicable
stage has a command or an explicit SKIP reason, and all commands have run in
the declared order.

## Output

Prefix runner output with `Source: runner`, then use its summary verbatim. For
fallback runs, report:

```markdown
## Verify (<fast|full>)

| Stage | Status | Command or reason |
|---|---|---|
| lint | PASS/FAIL/SKIP | |
| typecheck | PASS/FAIL/SKIP | |
| unit | PASS/FAIL/SKIP | |
| integration | PASS/FAIL/SKIP | |
| e2e | PASS/FAIL/SKIP | |

## Failures (if any)

- Root cause: <first failing command and error>
- Log or next action: <path or focused rerun>

## Overall: PASS / FAIL
```

Completion criterion: the report names the execution source (`runner` or
`fallback`), preserves every stage result, and makes the overall verdict agree
with the stage results.
