---
name: dep-audit
description: "Audit dependency security risks with an evidence-only verdict and an explicitly separate fix operation. Use for dependency vulnerability review. Not for: implicit upgrades, general code review, or treating a successful fix command as clearance. Output: audit findings, optional fix status, and a read-only security verdict."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Dependency Audit

## Workflow

Resolve `--level <severity>` to `low|moderate|high|critical`, defaulting to
`moderate`, and accept `--fix` only when explicitly supplied. Prefer the
consumer project's `$PROJECT_DIR/.claude/scripts/dep-audit.sh` (`$PROJECT_DIR`
means the explicitly selected consumer project root); if it exists, a failed run
is a real terminal audit failure and does not trigger fallback. Otherwise use
the ecosystem commands in [`references/workflow.md`](references/workflow.md).

Run the audit first. Only after a successful audit may explicit `--fix` run
the matching fix command; no fix is implicit. Finish with the separate,
read-only independent security evidence review defined in the local workflow.
An available `$change-verdict --mode security` is an optional way to obtain
that review; its installation is not required. The verdict may
inspect the audit output, but it never runs a fixer and a successful `--fix`
does not clear the original audit or prove a secure result.

## When NOT to Use

- Dependency changes are desired without an explicit `--fix`.
- Code, document, test, or merge review is the target.
- A security verdict is being inferred from an unavailable or failed audit.

## Output

Report ecosystem, level, command, exit status, severity counts, vulnerability
details, and whether an explicit fix was attempted. Keep the audit result and
the independent security result separate. End with `PASS`, `FAIL`,
`BLOCKED`, or `UNAVAILABLE`; unknown or missing evidence is not a pass.

## Verification

- [ ] The level and fix flag were preserved.
- [ ] Project script precedence and failure behavior were preserved.
- [ ] Audit completed before any explicit fix; no implicit mutation occurred.
- [ ] The final security verdict was read-only and did not treat fix success as
      clearance.

## References

- [`references/workflow.md`](references/workflow.md) — project-script
  precedence, ecosystem commands, fix boundary, and verdict output.
