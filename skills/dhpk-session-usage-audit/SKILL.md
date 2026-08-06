---
name: dhpk-session-usage-audit
argument-hint: '[--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD] [--agent NAME] [--format text|json] [--create-issues]'
description: 'Audits dhpk usage evidence in the current user home, correlates session failures with installed agents and package versions, verifies candidate defects, and prepares deduplicated GitHub issue evidence. Not for: remote fleet scans or automatic source changes. Output: redacted report, verified findings, and confirmed issue handoff. Explicit invocation only.'
allowed-tools: 'Read, Grep, Glob, Bash(node:*), Bash(gh:*), Bash(git:*), Bash(claude:*)'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# dhpk Session Usage Audit

Audit session evidence from the machine and user running this skill. The
collector is deterministic; model analysis may rank and explain findings, but
it cannot promote an observation to a GitHub issue without independent
verification and human confirmation.

## When NOT to Use

- Do not use for a single known GitHub issue; use the existing issue-analysis workflow.
- Do not use for source-code review or a direct bug fix.
- Do not use as a remote fleet collector; this skill is local-machine only.
- Do not use for a broad repository health score; use the repository-health workflow.

## Workflow

1. Resolve the date scope. No date means the current local day; `--date` is a
   single day; `--from/--to` is an inclusive range. Preserve source timestamps
   in UTC and use the machine timezone only for filtering.
2. Run the bundled collector with the requested `--agent` filters. It scans
   only the allowlist described in [source-adapters.md](references/source-adapters.md)
   and reports unsupported or skipped sources instead of guessing. Claude and
   native/project Codex JSONL plus known Orca NDJSON traces are parsed; private
   SQLite and aggregate usage stores remain explicitly omitted.
3. Read the JSON report. Separate installed agents, observed agents, strong
   dhpk evidence, weak text-only evidence, malformed records, and partial
   scans. Raw transcripts must never be copied into the report or prompt.
4. Use [finding-taxonomy.md](references/finding-taxonomy.md) to classify
   deterministic candidates. Use `/dhpk:dhpk-agent-architecture-audit` for wrapper,
   hook, memory, or agent-quality diagnosis when the evidence points there.
5. Reproduce the candidate against the relevant current dhpk consumer path.
   Put explicit argv arrays (not shell strings) for both checks in a local
   verification JSON. Inspect those exact commands, compute the file's
   `verificationDigest`, and pass it with `--execute-verification
   --verification-digest sha256:<64hex>`. Only allowlisted binaries without
   shell/interpreter-evaluation flags are executable (direct Node/PHP scripts
   only); package, Git, and GitHub commands are rejected. The runner records exit codes and only then can
   `verifyFinding` set `verified`. Without an executed receipt, keep status
   `needs-verification`.
6. Search existing issues by fingerprint, component, and symptom before
   drafting. Follow [issue-template.md](references/issue-template.md). Use
   `/dhpk:dhpk-issue-analyze` only when an existing issue needs deeper triage.
7. Show the sanitized draft and its `confirmationDigest` and gate reasons.
   `--create-issues` is still blocked until the user explicitly confirms the
   exact digest; duplicate, unauthenticated, low-confidence, or unverified
   findings must not be sent.
8. Return the issue URL (or an explicit blocked reason) and a handoff package.
   Do not create an OpenSpec change, edit source, or open a PR in this skill.

## Collector contract

Run from the plugin checkout or pass `--home`/`--output` explicitly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/dhpk-session-usage-audit/scripts/session-usage-audit.js" \
  --date 2026-08-06 --format json \
  --output .claude/artifacts/audits/session-usage/2026-08-06
```

`--home` is restricted to the current user's real home. There is no production
override for scanning another user's home; tests use a separate fixture-only
process boundary.

The output follows `dhpk.session-usage-audit.report.v1` and contains
`coverage`, `installations`, `sourceStats`, redacted `records`, `findings`,
`issueDrafts`, `issueResults`, and resource/partial-scan statistics. The script
also writes `report.md`, `report.json`, `findings.json`, `issue-drafts.json`,
`issue-results.json`, and `sessions.jsonl` below the requested output directory.
The output directory is runtime evidence and must remain gitignored.

## Issue gate

Use the exported `verifyFinding`, `buildIssueDraft`, `findDuplicateIssues`, and
`createIssue` functions for issue preparation. A finding is issue-ready only
when status is `verified`, confidence is at least `0.80`, two distinct argv
arrays actually exit zero under `--execute-verification`, duplicate search
succeeds with no exact fingerprint match, `gh` authentication is available,
and the user confirms the exact `confirmationDigest`. Component/symptom
matches are review candidates, not automatic duplicate blocks. A status-only
verification file never promotes a finding or authorizes an issue.
For CLI automation, pass a local JSON `--verification-file` containing finding
fingerprints plus `reproduction.argv` and `consumerGate.argv`; inspect it,
compute `verificationDigest` with the bundled module, and pass the digest when
running `--execute-verification` before preparing the issue draft.

## Output

Return the report directory, scope/coverage counts, installation evidence,
finding table, verification state, sanitized issue drafts, and either created
issue URLs or explicit blocked reasons. Keep the final handoff concise; the
JSON and Markdown artifacts are the detailed evidence record.

## Verification

- [ ] Date and agent scope are printed and match the request.
- [ ] Only allowlisted roots were read; omitted/unsupported sources are visible.
- [ ] Every candidate has a stable fingerprint and redacted evidence references.
- [ ] Reproduction and consumer/package validation both pass before `verified`.
- [ ] Existing issues were searched before any create operation.
- [ ] No raw transcript, token, absolute home path, or unrelated source change
      appears in the draft.
- [ ] Final output includes report path, finding status, issue URL or blocked
      reason, and the next OpenSpec handoff.

## References

- [source-adapters.md](references/source-adapters.md) — local roots, evidence
  strength, and unsupported-source behavior.
- [finding-taxonomy.md](references/finding-taxonomy.md) — deterministic rules,
  fingerprints, verification states, and false-positive handling.
- [issue-template.md](references/issue-template.md) — redaction and GitHub
  duplicate/create contract.
