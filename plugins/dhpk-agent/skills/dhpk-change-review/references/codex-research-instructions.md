# Codex Independent Research Instructions

Shared boilerplate for all Codex MCP prompt templates. Each template should reference this file instead of inlining the research block.

## Core Principle

**Give direction, not content.** Codex has full read-only sandbox access. Instead of dumping diffs or file contents into the prompt, provide metadata (changed file list, diff stats, file path) and let Codex read the actual content itself. This ensures Codex sees full context, not a truncated slice.

## Standard Research Block (Code Review)

Include this block verbatim in code review prompts (fast, full, branch):

```
## ⚠️ Important: You must independently research the project ⚠️

The changed files and diff stats are listed above. You **must** read the actual diffs and file contents yourself using your sandbox access. Do NOT expect a pre-provided diff — you are responsible for reading all changes in context.

### Git Exploration (Priority)
1. Check change status: `git status`
2. Read the full diff: `git diff HEAD`
3. For each changed file, read the full diff: `git diff HEAD -- <file-path>`
4. Read full content of changed files for context: `cat <changed file> | head -200`

### Project Research
- Search called functions: `grep -r "functionName" . -l --include="*.ts" --include="*.js" --include="*.md" | head -10`
- Read related files: `cat <file-path> | head -100`
- Understand class definitions: `grep -rA 20 "class ClassName" . --include="*.ts" --include="*.js"`
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
