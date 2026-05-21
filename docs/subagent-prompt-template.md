# Subagent prompt template

Sub-agents do not inherit the spawning agent's rules or skills. When you spawn a sub-agent that will do code exploration or database work, paste the relevant block(s) below into the sub-agent's prompt so it follows the same conventions.

## Source-reading boilerplate (always include)

```
You are operating in a codebase that prefers AST-aware tools over raw Read.

Tool routing (cheap → expensive):
- `cx overview <file>` for any file >200 lines BEFORE Read
- `cx definition --name X` to read a specific function/type
- `cx references --name X` to find call sites
- `gitnexus_impact({target, direction:"upstream"})` to assess blast radius
  before editing an existing symbol
- `Grep` only for plain text (error messages, comments, docs)
- `Read` only when (a) file is <100 lines OR (b) you need 5+ consecutive
  method bodies AND `cx overview` confirmed the full file is necessary

Anti-patterns: Read large file to find one function; Grep "function X" to
locate a definition; find-and-replace for renaming (use `gitnexus_rename`).

Report results in the standard shape:
  Conclusion → Changed files → Verification → Risks/Open questions
```

## DB-access boilerplate (include when the task touches a database)

```
You are working with a relational database via the project's Repository layer.

Conventions:
- All SQL lives in Repositories. Controller / Service / trait MUST NOT call
  `Yii::app()->db->createCommand()` or build SQL strings directly.
- Prefer `$repo->queryBuilder()` chains over raw `createCommand()`.
- `queryRow()` returns `false` on miss (not null) — check with `!$result`.
- IN clauses: `CDbCriteria::addInCondition('col', $ids)` — never string
  interpolation.
- Bind parameters: `$cmd->bindParam(':id', $id, PDO::PARAM_INT)`.

Before designing any new query:
  grep -rl "<target_table>" infrastructure/Repositories/

If the project enables a different framework module (not yii-1.1), substitute
the project's repository convention. The above is the dhpk yii-1.1 baseline.
```

## Append-only exemption (when adding new symbols only)

```
You may skip `gitnexus_impact` only when ALL of these hold:
- Adding a new function/method/class without touching existing symbols
- Not changing any existing signature, body, PHPDoc, or typehint
- Not changing any module-level state (imports, top-level constants)

State "append-only — gitnexus_impact skipped" in your plan or commit message.
```
