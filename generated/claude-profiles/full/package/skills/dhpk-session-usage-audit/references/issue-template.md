# GitHub issue contract

## Draft shape

```markdown
## Summary
- Repository: hmj1026/dhpk
- dhpk version: <version>
- Category: <category>
- Fingerprint: sha256:<...>
- Confidence: <0.00-1.00>
- Occurrences: <count>

## Observed behavior
<redacted symptom>

## Evidence
- <redacted path>:<line> (session <id>, agent <name>)

## Expected behavior
The dhpk consumer path should complete without this package-specific failure.

## Verification
Status: verified
Reproduction: PASS — <command and recorded exit code 0>
Consumer gate: PASS — <command and recorded exit code 0>

Confirmation digest: sha256:<64 lowercase hex characters>
```

The title starts with `[session-audit]`. Do not include complete transcripts,
tokens, cookies, customer data, full prompts, or absolute user paths.

## Duplicate and create sequence

1. Confirm `gh auth status` succeeds.
2. Search all issue states with the exact fingerprint, component, and symptom:

   ```bash
   gh issue list --repo hmj1026/dhpk --state all \
     --search 'sha256:<fingerprint>' --limit 20 \
     --json number,title,state,url
   ```

   `findDuplicateIssues` performs all three searches and blocks on an exact
   fingerprint match or any search error. Component/symptom matches are
   returned as review candidates so a generic hook issue cannot suppress a
   distinct fingerprint.

3. If an exact fingerprint match exists, append evidence to the existing issue
   only after human confirmation; do not open a duplicate. Component/symptom
   candidates without that exact fingerprint require triage and do not block
   the new issue by themselves.
4. If no match exists, show the complete sanitized title/body and ask for
   confirmation of that exact payload.
5. Show the sanitized draft and digest, obtain confirmation for that exact
   digest, then use `createIssue` so the executed-verification,
   confidence/auth/duplicate/confirmation gate is evaluated immediately before
   `gh issue create`.

Issue creation is the only external mutation in this workflow. Source edits,
OpenSpec changes, PRs, labels, and comments beyond an explicitly approved
duplicate update are out of scope.
