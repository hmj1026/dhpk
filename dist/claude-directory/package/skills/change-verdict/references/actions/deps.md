# Dependency audit and remediation

Default `deps` is a read-only dependency audit. Explicit `deps fix`, `--fix`,
or an equivalent user request authorizes a separate bounded remediation
delegation in the selected consumer project. Reuse that authority without
asking again for the same fix; it grants no arbitrary source repair, staging,
commit, publication, or gate change.

## Audit

1. Resolve the consumer project root and optional `--level <severity>`;
   accept `low|moderate|high|critical`, default `moderate`. Resolve an explicit
   fix request separately from the audit arguments.
2. Check the required local procedures before any dependent operation. A
   missing bundled reference is `BLOCKED` with its local path; do not borrow
   a sibling skill or checkout copy. Package delivery must include this file,
   [`../security/codex-prompt-security.md`](../security/codex-prompt-security.md),
   [`../shared/review-common.md`](../shared/review-common.md), and
   [`../shared/review-rubric.md`](../shared/review-rubric.md).
3. Resolve an available read-only audit capability. Delegate audit execution
   to a read-only reviewer with the project root, severity, and an explicit
   no-write/no-fix scope. Direct execution is available only when the Host
   supplies a provably exact read-only command grant for the selected form.
   This skill adds no unrestricted shell or package-manager wildcard grant;
   a pattern that also accepts `--fix` or a fix subcommand is insufficient.
   Without a usable read-only audit capability, return `UNAVAILABLE`.
4. Prefer `$PROJECT_DIR/.claude/scripts/dep-audit.sh` when present. This is
   an explicit consumer input, not a bundled resource. Inspect its argument
   and write behavior first; invoke its read-only audit operation from the
   consumer root with the severity arguments and **without `--fix`**. If its
   audit cannot run without workspace writes, return `BLOCKED`. Its failure
   is terminal; do not fall back to an ecosystem command to hide failure.
5. Otherwise select the first matching manifest/lockfile row below. These are
   command candidates for the resolved audit/writer capabilities, not direct
   parent tool grants. Missing
   tools or an unrecognized ecosystem returns `UNAVAILABLE`/`BLOCKED` with
   detection evidence. Use installed tools; installing audit tooling or
   creating project caches/artifacts requires separate authority. If an
   audit writes reports by default, choose its read-only/stdout option or
   return `BLOCKED`.

   | Manifest | Read-only audit | Explicit remediation |
   | --- | --- | --- |
   | `package.json` + `pnpm-lock.yaml` | `pnpm audit --audit-level <level>` | `pnpm audit --fix` |
   | `package.json` + `yarn.lock` | `yarn audit --level <level>` | `yarn audit --fix` or installed `yarn-audit-fix` |
   | `package.json` | `npm audit --audit-level=<level>` | `npm audit fix` |
   | `pyproject.toml` | installed `pip-audit` or `safety check` | `pip-audit --fix` |
   | `Cargo.toml` | `cargo audit` | `cargo audit fix` |
   | `go.mod` | `govulncheck ./...` | manual dependency remediation |
   | `build.gradle` | `./gradlew dependencyCheckAnalyze` only with a verified no-write audit configuration | manual dependency remediation |

6. Record the exact command, exit status, severity counts, and findings.
   Interpret nonzero status using that tool's exit contract: vulnerability
   findings can be completed audit evidence, while tool, infrastructure, or
   opaque execution failures are terminal audit failures. Preserve the
   original findings and status through any later fix.

## Explicit remediation

After a completed audit, delegate remediation only if the user explicitly
authorized it. Resolve an existing writer capability that can receive the
bounded scope. Give it the exact consumer project/package, affected
dependencies and versions, permitted dependency files/artifacts, allowed
remediation operation, original audit evidence, and preservation requirements
for all other work. Reuse the user's authorization for that same scope;
do not ask for it again. A known vulnerability exit
does not itself prevent an authorized fix; an incomplete or opaque failed
audit does. A project-script failure remains terminal.

The writer may invoke a project script's separate fix operation only after
inspecting its contract and verifying it stays within the authorized scope.
It may otherwise use the matching ecosystem fix or bounded dependency-file
edits within its received grant. The parent executes neither fix commands nor
manual edits. An absent writer or a Host unable to supply the bounded writer
capability returns `UNAVAILABLE` with the missing capability and preserved
audit evidence; there is no direct-write fallback. A proposed fix outside the
authorized package/files/remediation scope returns `BLOCKED` with the required
scope decision. Force upgrades, unrelated source edits, and installing a new
fix tool require separate authority.

Require before/after tracked and untracked file bytes, Git index/status, and
lockfiles from the execution capability, then inspect its actual diff and
result. Default audit must leave them unchanged;
remediation may change only the authorized dependency files and declared
dependency artifacts. Report unexpected changes as a failure and preserve
the evidence; do not reset or remove caller work to conceal them. A successful
fix command is only an operation result.

## Independent security verdict

After fix execution, and for the default audit's final verdict, obtain a
separate read-only review from an independent security reviewer. Provide the
selected scope, audit command/output/status, dependency findings, exact
dependency diff, and fix result, if any. Use an available independent
`security-reviewer` or another explicitly permitted independent security
capability; its absence is `BLOCKED: INDEPENDENT_REVIEW_UNAVAILABLE`.
The auditing/fixing agent's own reread cannot supply that review.

Give the independent reviewer the local
[`security prompt`](../security/codex-prompt-security.md),
[`evidence rules`](../shared/review-common.md), and
[`verdict rubric`](../shared/review-rubric.md). It reports evidence-backed
severity and affected dependencies with `READY`, `BLOCKED`, or `INCONCLUSIVE`;
it performs no fixes, installs, upgrades, or gate writes. Keep a failed or
unavailable review non-pass even when remediation succeeded.

## Output and completion

Report ecosystem, level, command/status, severity table, vulnerabilities,
explicit authority and bounded fix result, workspace change evidence, and
the independent security verdict separately. End with `PASS`, `FAIL`,
`BLOCKED`, or `UNAVAILABLE`: vulnerabilities or command failure remain `FAIL`;
missing required evidence remains `BLOCKED`/`UNAVAILABLE`. A fixed
vulnerability needs a new successful audit observation and independent
security evidence before any response-level `PASS`. The original failed
audit remains visible. No result writes or clears a repository gate.
