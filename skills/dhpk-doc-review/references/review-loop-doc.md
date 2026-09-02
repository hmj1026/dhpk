# Document Review Loop

## Re-review Prompt Template

Used by the primary reviewer when the document is revised:

```typescript
review({
  review_artifact: '<from --continue parameter>',
  prompt: `I have revised the document. Please re-review:

## Document Path
${FILE_PATH}

Please read the updated document yourself using \`cat ${FILE_PATH}\` and verify:
1. Have previous 🔴 must-fix items been addressed?
2. Did revisions introduce new issues?
3. What is the quality of the revised document?
4. Update Gate status`,
});
```

## Loop Rules

When review result is ⛔ Needs revision:

1. Remember the `review_artifact`
2. Revise the document
3. Re-review using `--continue <review_artifact>`
4. Repeat until ✅ Mergeable

## Gate Sentinels (for Hook parsing)

- `✅ Mergeable` / `## Gate: ✅` — Passed
- `⛔ Needs revision` / `## Gate: ⛔` — Failed
