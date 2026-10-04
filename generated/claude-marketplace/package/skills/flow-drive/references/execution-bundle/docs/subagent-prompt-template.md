# Subagent prompt template

Cold sub-agents do not inherit the spawning agent's rules or skills. When you spawn a cold sub-agent that will do code exploration or database work, paste the relevant block(s) below into the sub-agent's prompt so it follows the same conventions.

## Standalone task packet (always include for a cold or named-specialist handoff)

The execution policy owns the dispatch parameters. Put the complete task in the
`message` field using this shape; no instruction may depend on parent history.

```text
Working directory: <absolute project or worktree path>

Goal and non-goals:
- Goal: <one concrete outcome>
- Non-goals: <explicit exclusions>

Scope:
- Target role and available tools: <exact role and only tools exposed to this
  recipient for this task>
- Read scope: <paths or systems the agent may inspect>
- Write scope: <exact repo-relative files, or "read-only">
- Supplied context for unavailable tools: <required symbol/caller/graph evidence,
  command output, or source excerpts the recipient cannot obtain; or "none">

Constraints and settled decisions:
- <interfaces, invariants, compatibility limits, and user decisions>

Verification and acceptance:
- <commands or observable pass conditions>

Task identity and evidence:
- Task/attempt id: <stable task id and attempt-specific id>
- Evidence pointers: <required files, artifacts, or prior conclusions>

Output contract:
- <required headings, evidence shape, edited-file report, and terminal status>
```

## Source-reading guidance (select by capability)

When a task needs source inspection, include only instructions for tools the
recipient can call. The packet author supplies any required inspection results
or source context the recipient cannot obtain. Never ask the recipient to run a
shell command, CX or GitNexus query, repository search, database probe, or
child-agent dispatch unless that capability is available and the task scope
authorizes it. If required evidence is missing and no available tool can obtain
it, the recipient reports that gap.

```
Use only the repository-inspection tools listed for this dispatch and allowed by your role.

- When `cx` is available, prefer `cx overview <file>`,
  `cx definition --name X --from <file>`, and `cx references --name X` for
  symbol-level source inspection.
- When GitNexus is available and project policy requires graph analysis, run
  `impact({target, direction: "upstream"})` before editing an existing symbol.
  The packet supplies the result when the recipient cannot run it; preserve an
  `UNKNOWN` result and its text-search confirmation as unresolved evidence.
- Use repository search and file-reading tools only when they are exposed to
  this recipient. Supply definitions, callers, relevant paths, or excerpts when
  the recipient cannot inspect them directly.
- Run shell commands only through a declared command tool. Dispatch children
  only when a child-agent tool is exposed and delegation is authorized.

Avoid reading a large file to find one function or searching for a symbol
definition in plain text when `cx` is available. Do not require unavailable
tools; report missing evidence instead.

Report results in the standard shape:
  Conclusion → Changed files → Verification → Risks/Open questions
```

## Progressive references (select, do not preload)

The packet is a context boundary, not a copy of the parent session or the
entire skill body. Add only the references required by the requested phase:

```text
Phase: <explore | red | green | review | verify>
References:
- <repo-relative reference path or selector>
Load rule: <one sentence describing why each reference is needed>
```

For a GREEN implementation (the implementation phase after a failing RED
test) or a test scaffold, select the matching TDD (test-driven development)
reference and omit the full TDD teaching body. For a review, select the
relevant standards and evidence references only. A worker must report
`DISPATCH_PACKET_INCOMPLETE` when the packet has no phase, reference selector,
or verification contract; it must not infer missing context from parent
history.

## DB-access boilerplate (database scope + available recipient capability)

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

Before designing any new query, use an available command/search tool to locate
existing table usage:
  grep -rl "<target_table>" <repository-dir>   # adjust path to your project's repository layer

If you do not have a command/search tool, the packet author must provide the
matching repository references and search results so you can inspect existing
usage first.

If the project enables a different framework module (not yii-1.1), substitute
the project's repository convention. The above is the dhpk yii-1.1 baseline.
```

## GitNexus append-only exemption (when required and available)

```
You may skip `gitnexus_impact` only when ALL of these hold:
- Adding a new function/method/class without touching existing symbols
- Not changing any existing signature, body, PHPDoc, or typehint
- Not changing any module-level state (imports, top-level constants)

State "append-only — gitnexus_impact skipped" in your plan or commit message.
```
