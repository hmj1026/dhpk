# Independent Research Instructions

Shared boilerplate for all review prompt templates. Each template should
reference this file instead of inlining the research block.

## Core Principle

**Give direction, not content.** The selected reviewer has read-only sandbox
access. Supply the resolved scope and fixed point, plus any metadata the caller
actually provides, then let the reviewer read the source. Treat summaries as
navigation hints and collect missing metadata from the selected repository
snapshot. This keeps the prompt aligned with the reviewed content.

## Standard Research Block (Code Review)

This is the single research block for code prompts (fast, full, branch). Each
prompt links here rather than copying it:

```
## Scope and fixed point

Use the exact scope and fixed point already resolved by the shared review
workflow. Read actual changes and relevant context within that scope. If either
value is missing, contradictory, or unreadable, return `INCONCLUSIVE`.

- For an uncommitted diff, use the recorded `HEAD` commit as the comparison
  point and inspect the selected working-tree changes.
- For a branch, use the recorded merge-base SHA for diff and history reads. Do
  not resolve the named base branch again or use a moving `BASE_BRANCH..HEAD`
  range.
- For a selected path set, keep reads and conclusions within those paths and
  the context needed to assess them.

The bundled CLI wrapper supplies the selected scope, review depth, and pinned
merge-base value in its workflow text. It does not synthesize a changed-file
list, diff statistics, focus text, request document, local check results,
branch name, or commit count. Read any additional metadata from the selected
repository snapshot; do not assume other prompt values are injected.

## Project research

Read related source, callers, dependencies, tests, and documentation only when
they help assess the selected changes. Use the repository's available
read-only code navigation and file-reading tools. Preserve the same scope and
fixed point for every follow-up read.

## Code-only evidence

Assess Standards and Spec separately as described by the sibling
`review-common.md`. Report unavailable evidence as a visible gap and use the
sibling `review-rubric.md` for the final verdict.
```

## Variant: Document Review

```
## ⚠️ Important: You must independently read and research the project ⚠️

The document path is provided above. You **must** read the document content and research the project yourself using your sandbox access. Do NOT expect pre-provided file content — you are responsible for reading the document and verifying its accuracy.

### Document Reading (Priority)
1. Read the full document: `cat ${FILE_PATH}`
2. If the document is long: `cat ${FILE_PATH} | head -300` then `cat ${FILE_PATH} | tail -200`

### Code-Documentation Consistency Research
1. Check project structure: `ls src/`, `ls scripts/`, `ls skills/`
2. Search related code: `grep -r "keyword" . -l --include="*.ts" --include="*.js" --include="*.sh" | head -10`
3. Read related files: `cat <file-path> | head -100`
```

## Variant: Security Review

```
## ⚠️ Important: You must independently research the project ⚠️

Security review requires full context. You **must** independently research:

1. `grep -r "auth\|token\|session" src/ -l | head -10`
2. `grep -r "@Body\|@Query\|@Param" src/ -A 5 | head -50`
3. `grep -r "password\|secret\|key" src/ -l`
```

## Variant: Test Review / Test Gen

```
## ⚠️ Important: You must independently research the project ⚠️

When reviewing test coverage, you **must** perform the following research:

### Research Steps
1. Check project structure: `ls src/`, `ls test/`
2. Search related code: `grep -r "className" src/ -l | head -10`
3. Read source file: `cat <source path> | head -150`
4. Check existing tests: `ls test/unit/` or `cat test/unit/xxx.test.ts | head -50`
```

## Variant: Code Explanation

```
## ⚠️ Important: You must independently research the project ⚠️

Before explaining code, you **must** independently research:

### Research Steps
1. Check project structure: `ls src/`
2. Trace imports: `grep -r "import.*from" ${FILE_PATH} | head -10`
3. Read dependencies: `cat <dependency path> | head -100`
4. Find callers: `grep -r "function name" src/ -l | head -5`
```
