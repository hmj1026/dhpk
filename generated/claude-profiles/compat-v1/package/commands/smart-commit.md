---
description: 'Smart batch commit — group changes by cohesion, generate commit messages matching project style, output git commands'
argument-hint: '[--scope <path>] [--type <type>] [--ai-co-author]'
allowed-tools: 'Bash(git:*), Read, Grep, Glob'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

Forward `$ARGUMENTS` unchanged to the explicit-only, git-write
`$git-smart-commit` Skill.
It owns status/diff collection, sensitive-file handling, cohesive grouping,
project-style messages, confirmation, and copy-pasteable git commands.

Preserve the `--scope`, `--type`, and `--ai-co-author` options and the
execution-policy git-pipeline boundary. Relay the owner’s plan or executed
result; do not add a second commit grammar or claim commits were created from
commands that were only proposed.
