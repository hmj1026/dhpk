# Development Test and Review Gate

This gate is shared by feature development and bug fixes.

## Test Conventions

Use Arrange-Act-Assert structure, behavior-describing test names, and evidence-based adequacy that asserts observable output rather than internal calls. Consumer project overrides in `.claude/rules/` take precedence for directories, runners, and adequacy mode.

## Step 1 — Run Tests

Run `/verify`. Fix any failures and rerun until all tests pass.

## Step 2 — Review Test Adequacy

For code changes this gate is mandatory:

```text
/codex-test-review → ✅ Tests sufficient?
  Yes → Step 3
  No → close gaps → /codex-test-review --continue <threadId>
```

Close unit gaps with `/codex-test-gen`, and integration/E2E gaps with `/post-dev-test`; write the tests and rerun `/verify` before continuing.

## Step 3 — Review Code

```text
/codex-review-fast → ✅ Ready?
  Yes → Precommit Gate
  No → fix issues → rerun /codex-review-fast
```

If code changes after the latest `✅ Tests sufficient` result, rerun `/verify` and `/codex-test-review --continue <threadId>` before precommit.

## Review Loop Gate

Re-review after every fix until PASS, subject to `rules/execution-policy.md` §Anti-loop review-loop ceiling:

`Review → issues → fix → re-review → ✅ Pass → next step`
