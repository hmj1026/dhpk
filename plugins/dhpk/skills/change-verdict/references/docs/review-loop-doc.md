# Read-only Document Comparison

## Comparison Prompt Template

Used only when the caller supplies a second document snapshot:

```typescript
review({
  prompt: `Compare the supplied document snapshots without editing either one:

## Document Path
${FILE_PATH}

Please read the updated document yourself using \`cat ${FILE_PATH}\` and verify:
1. Which evidence-backed findings changed?
2. Did the new snapshot introduce new issues?
3. What is the current quality and evidence state?
4. Return READY, BLOCKED, or INCONCLUSIVE`,
});
```

## Comparison Rules

The caller owns any revision. This skill only compares readable snapshots and
returns a response; it does not revise a document, persist an artifact, or
update a gate/sentinel.
