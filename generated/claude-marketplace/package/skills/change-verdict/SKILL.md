---
name: change-verdict
description: 'Read-only verdicts for code changes, pull requests, security, tests, documents, or change risk. Use when judging an existing change or evidence set. Not for implementing fixes, generating tests, editing documents, clearing gates, or architecture-only design. Output: evidence-backed findings, degradation state, and READY, BLOCKED, or INCONCLUSIVE.'
allowed-tools: 'Bash(git diff:*), Bash(git status:*), Bash(git merge-base:*), Bash(git rev-parse:*), Bash(git show:*), Bash(git log:*), Bash(git ls-files:*), Bash(git hash-object:*), Bash(gh pr view:*), Bash(node skills/change-verdict/scripts/risk-analyze.js:*), Bash(bash skills/change-verdict/scripts/check-unrelated-changes.sh:*), Bash(bash skills/change-verdict/scripts/review-cli.sh:*), Bash(codex review:*), Read, Grep, Glob'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Change Verdict

Use the smallest mode that answers the question. This is a read-only observer
of source, diffs, tests, documents, metadata, and tool output; it returns a
verdict and text-only recommendations, never repository or review-state edits.

## Modes

| Mode | Question answered | Read when |
|---|---|---|
| `code` | Is a fixed-point diff correct, safe, and consistent with its spec? | Reviewing code changes or a branch. |
| `pr` | Is a proposed PR complete and hygienic for its declared merge method? | Self-reviewing a branch or inspecting PR metadata. |
| `security` | Are security-sensitive paths exposed to OWASP risks or unsafe dependencies? | Auditing auth, input, secrets, dependencies, or security-sensitive changes. |
| `tests` | Do existing tests and acceptance evidence cover the behavior? | Reviewing test adequacy or tracing ACs to evidence. |
| `docs` | Is a document accurate, complete, and consistent with the code? | Reviewing Markdown, specs, READMEs, or design documents. |
| `risk` | What breaking surface, blast radius, and change-scope signals are present? | Assessing an uncommitted diff or large refactor. |

If `--mode` is omitted, infer one mode only when unambiguous; otherwise report
`INCONCLUSIVE` with the minimum clarification needed. Do not run multiple modes.

## When NOT to Use

- Implement or fix a finding → use `flow-drive`.
- Trace an unfamiliar code path → use `code-trace`.
- Author or audit a skill → use `skill-forge` or `skill-scope`.

## Shared read-only protocol

1. Resolve a fixed point before reading findings: use a non-empty
   `git merge-base <base> HEAD` for branch work, or `HEAD` for an uncommitted
   diff. Record the exact value.
2. Read the actual diff and relevant files yourself. Treat caller-provided
   summaries as navigation hints, never as evidence.
3. Use file-and-line evidence for every material finding. Redact secrets,
   tokens, cookies, private keys, and personal data from output.
4. Keep primary-model evidence separate from an optional CLI second opinion.
   The primary path is complete without the CLI; unavailable or unrequested
   CLI evidence is explicitly `degraded: primary model only`.
5. Return a verdict without changing repository state. A missing fixed point,
   unavailable dependency, unreadable scope, or contradictory evidence keeps
   the result `INCONCLUSIVE` or `BLOCKED`; it never becomes an assumed pass.

No mode may run a formatter, fixer, generator, commit, staging command,
artifact writer, gate/sentinel emitter, or writer-dispatch loop. A re-review
continuation must remain read-only and re-read only a caller-supplied snapshot.

## Mode procedures

### `code`

Pin the diff, inspect changed files and their callers/callees, then evaluate
the Standards and Spec axes independently. Load the relevant prompt in
`references/code/` and the shared evidence rules in
`references/shared/review-common.md`. Rank findings `P0`, `P1`, `P2`, or
`Nit`; only P0/P1 block a complete verdict. Do not call a P2/Nit suggestion a
fix cycle.

### `pr`

Read branch/base metadata, commits, changed files, and the declared merge
method. Run `scripts/check-unrelated-changes.sh` only as a read-only advisory
scan when PR metadata is available. Report correctness, security, performance,
tests, docs, and squash hygiene separately. The scan's advisory exit status
does not override evidence or hide unrelated files.

### `security`

Inspect the requested scope and its boundaries, then apply the OWASP checklist
from `references/security/codex-prompt-security.md`. Dependency checks are
advisory unless their command and result are present. Label each issue with
its OWASP category, severity, location, impact, remediation text, and a safe
verification method.

### `tests`

Read the source and corresponding tests at the public seam. Assess happy path,
errors, edge cases, and mock quality. With `--ac-trace`, parse non-quality-gate
acceptance criteria and map each to independent test/runtime evidence or a
validated exception. Load the mode-specific prompts in `references/tests/`.
Missing evidence is a gap, not an instruction to add tests in this skill.

### `docs`

Read the complete target document and enough source/configuration to check
accuracy. Rate architecture, performance, security, documentation quality,
and code consistency. Load `references/docs/review-loop-doc.md` only when the
caller supplies a prior snapshot for comparison; never edit the document or
persist a review snapshot.

### `risk`

Run `scripts/risk-analyze.js --json` only against the current read-only tree
and capture its JSON output. Interpret breaking surface, blast radius, and
change scope with `references/risk/`. If deep history is requested, read git
history without writing caches or reports. Preserve the script's score and
add a qualitative explanation; do not turn risk into authorization to change
the code.

## Optional CLI second opinion

Only an explicit `--second-opinion=codex-exec` may invoke
`scripts/review-cli.sh --backend cli`. Pass a self-contained scope and pinned
snapshot, never the primary conclusion; keep output separate, redact it, record
its status, and reconcile after both observations. A CLI failure is degraded
evidence, not a fallback or a reason to write an artifact.

## Output contract

```markdown
## Change verdict: <mode>
- Fixed point: <merge-base or HEAD>
- Scope: <path/diff/branch/document>
- Sources: primary=<complete|degraded>; cli=<not requested|passed|failed>

### Findings
- [P0/P1/P2/Nit] <file:line> <evidence-backed issue> -> <text-only remediation>

### Evidence gaps
- <missing or contradictory evidence, or none>

### Verdict: READY | BLOCKED | INCONCLUSIVE
```

`READY` requires a pinned point, readable scope, and no blocking finding;
`BLOCKED` means a P0/P1 finding or required safety condition prevents a
complete verdict, while `INCONCLUSIVE` means evidence is insufficient. The
response is the only output; no file, state, or sentinel is created.

## References

- `references/shared/review-workflow.md` — read-only collection and aggregation sequence.
- `references/shared/review-common.md` — severity, evidence, and degradation rules.
- `references/shared/cli-backend.md` — explicit CLI transport contract.
- `references/code/`, `security/`, `tests/`, `docs/`, `risk/` — mode-specific prompts and checklists.
- `scripts/review-cli.sh`, `scripts/check-unrelated-changes.sh`, `scripts/risk-analyze.js` — read-only helpers.

## Verification

- [ ] Exactly one mode, scope, and fixed point are recorded.
- [ ] The actual source/diff/document was independently read and evidence is file:line based.
- [ ] Findings are severity-ranked and mode-appropriate; unknowns remain explicit; no file, artifact, gate/sentinel, staging area, or writer was invoked.
- [ ] Optional CLI use was explicit, isolated, redacted, and labeled; otherwise degradation is stated.
