# Dependency audit workflow

1. Parse `[--level <severity>] [--fix]`. Use `moderate` when no level is
   supplied; reject values outside `low`, `moderate`, `high`, and `critical`.
2. Let `$PROJECT_DIR` denote the explicitly selected consumer project root.
   Check for `$PROJECT_DIR/.claude/scripts/dep-audit.sh`. If found, run
   `bash "$PROJECT_DIR/.claude/scripts/dep-audit.sh" $ARGUMENTS` from that
   project. This is consumer input, not a bundled Skill resource. A success owns
   the audit output; a failure is terminal and must not silently fall back.
3. Without that project script, detect the first matching manifest and use:

   | Manifest | Audit | Explicit `--fix` |
   | --- | --- | --- |
   | `package.json` + `pnpm-lock.yaml` | `pnpm audit --audit-level <level>` | `pnpm audit --fix` |
   | `package.json` + `yarn.lock` | `yarn audit --level <level>` | `yarn audit --fix` or `npx yarn-audit-fix` |
   | `package.json` | `npm audit --audit-level=<level>` | `npm audit fix` |
   | `pyproject.toml` | `pip-audit` or `safety check` | `pip-audit --fix` |
   | `Cargo.toml` | `cargo audit` | `cargo audit fix` |
   | `go.mod` | `govulncheck ./...` | manual remediation only |
   | `build.gradle` | `./gradlew dependencyCheckAnalyze` | manual remediation only |

   If no manifest is recognized, return `UNAVAILABLE`/`BLOCKED` with the
   detection evidence.
4. Do not run a fix unless `--fix` was explicit and the audit completed. Keep
   the audit exit status and findings even if the fix command succeeds or
   fails. A fix is an operation result, not a verdict.
5. Obtain a separate read-only review from an independent security reviewer.
   An available `$change-verdict --mode security` may delegate this step;
   otherwise use the Host's independent reviewer capability with this local
   contract: inspect the recorded audit command, exit status, dependency
   findings and explicit fix result; report evidence-backed severity and
   affected dependencies; do not execute fixes, installs, or upgrades; do not
   infer clearance from fix success. Record `READY`, `BLOCKED`, or
   `INCONCLUSIVE` independently from the package-manager result. If neither
   route can supply an independent reviewer, return `BLOCKED` with
   `INDEPENDENT_REVIEW_UNAVAILABLE`. The auditing agent must not self-approve
   or substitute its own reread for that missing review.
6. Render the severity table and vulnerability details, then a Gate section:
   `PASS` only when the audit and required read-only evidence support it;
   `FAIL` for found vulnerabilities or command failure; `BLOCKED` for missing
   required evidence. A successful fix alone never changes this gate.
