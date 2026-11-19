# Repository verification workflow

1. Normalize arguments before running anything. No mode or `full` selects
   lint, typecheck, unit, integration, and e2e; `fast` selects lint and unit.
   Accept one mode token only. `--integration <path>` and `--e2e <path>` are
   explicit single-file opt-ins for their matching full-mode stages; an absent
   optional path remains a normal stage skip.
2. Check for
   `.claude/dhpk/skills/repo-verify/scripts/verify-runner.js` at the consumer
   project root. If present, run:

   ```bash
   node .claude/dhpk/skills/repo-verify/scripts/verify-runner.js $ARGUMENTS
   ```

   The project runner owns package-manager detection, stages, logs, skips, and
   the overall line. `PASS` passes; `FAIL`, a crash, an execution error, or a
   missing overall line is terminal. A semantic `FAIL` in the Markdown summary
   or `summary.json` `overallPass=false` is terminal even when the process exits
   zero. Keep the project runner selected once found.
3. If the project runner is absent and the consumer has `package.json`, check
   the installed package for `$SKILL_DIR/scripts/verify-runner.js` and run:

   ```bash
   node "$SKILL_DIR/scripts/verify-runner.js" $ARGUMENTS
   ```

   Apply the same authoritative-output and terminal-failure rules. `$SKILL_DIR`
   is the resolved installed directory containing this `SKILL.md`, and its
   adjacent `scripts/lib/runner-utils.js` is part of the local runtime closure;
   the consumer cwd is unchanged.
4. If no runner applies, detect the first recognized manifest and run the
   available fallback commands in order: lint, typecheck when applicable,
   unit/project test, then requested integration/e2e. Preserve these rules:

   | Manifest | Fast | Full additions |
   | --- | --- | --- |
   | `package.json` | `{pm} lint`; `test:js`, then `test:unit`, then `test` | `typecheck` or local `npx --no-install tsc --noEmit`; explicit integration/e2e |
   | `pyproject.toml` | `ruff check .`; `pytest` | `mypy .` |
   | `Cargo.toml` | `cargo clippy`; `cargo test` | compilation/typechecking is implicit |
   | `go.mod` | `golangci-lint run`; `go test ./...` | `go vet ./...` |
   | `build.gradle`/`pom.xml` | project lint/test tasks when present | build/typecheck is implicit |

   For Node, detect the package manager from its lockfile and read
   `package.json`. Missing scripts/tools are `SKIP` with their exact reason;
   a manifest with no recognized fallback is terminal `FAIL`.
5. Emit:

   ```markdown
   ## Verify (<fast|full>)

   | Stage | Status | Command or reason |
   |---|---|---|
   | lint | PASS/FAIL/SKIP | |
   | typecheck | PASS/FAIL/SKIP | |
   | unit | PASS/FAIL/SKIP | |
   | integration | PASS/FAIL/SKIP | |
   | e2e | PASS/FAIL/SKIP | |

   ## Overall: PASS / FAIL
   ```

   Include failure root cause and log/next action when applicable. Completion
   requires all applicable stages and one overall verdict.
