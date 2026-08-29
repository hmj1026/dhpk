---
name: update-docs
description: "Research the current dhpk implementation and update user or agent docs without changing source semantics."
---
# `/dhpk:update-docs`

## Contract

Use this command after a public workflow, route, setup, distribution, or
configuration change makes a document stale. It may also be invoked with a
document path or workflow keyword for a bounded refresh. It updates Markdown
and other documentation only; it does not edit application source, tests, the
route table, or generated runtime projections.

Do not use it for codemap generation (`/dhpk:update-codemaps`), a policy or
link/frontmatter review (`/dhpk:codex-review-doc` or `dhpk-doc-review`), or
external-library research (`docs-lookup`). The `doc-updater` agent owns the
same contract when structural changes require a proactive handoff; this command
is its user-facing entry point.

Read the nearest policy before editing:

- [`docs/agent-guidance/writing-for-agents.md`](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/writing-for-agents.md)
  defines pointer, hierarchy, completion, pruning, and boundary checks.
- [`docs/agent-guidance/command-contract.md`](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-contract.md)
  defines command-level evidence and handoff expectations.
- [`rules/execution-policy.md`](https://github.com/hmj1026/dhpk/blob/main/rules/execution-policy.md) owns dispatch,
  reviewer, and dirty-worktree boundaries.

The implementation and distribution SSOT map is:

| Fact | Prefer this owner |
|---|---|
| Public names, surfaces, counts | [`manifests/distribution-inventory.json`](https://github.com/hmj1026/dhpk/blob/main/manifests/distribution-inventory.json) |
| Route matching and invocation class | `skills/dhpk-do/references/route-table.json`, `skills/dhpk-do/scripts/route-result.js`, and `commands/do.md` |
| Effective configuration | [`docs/configuration.md`](https://github.com/hmj1026/dhpk/blob/main/docs/configuration.md) and its Traditional Chinese pair |
| Install, update, migration, rollback | [`docs/platform-installation.md`](https://github.com/hmj1026/dhpk/blob/main/docs/platform-installation.md), [`docs/skill-platform-migration.md`](https://github.com/hmj1026/dhpk/blob/main/docs/skill-platform-migration.md) |
| Runtime workflow, receipts, and gate outcomes | [`docs/harness-workflow.md`](https://github.com/hmj1026/dhpk/blob/main/docs/harness-workflow.md) and the owning harness scripts |
| Agent-writing rules | [`docs/agent-guidance/writing-for-agents.md`](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/writing-for-agents.md) |

## Workflow

### 1. Bound the target

Treat `$ARGUMENTS` as either an existing documentation path or a workflow
keyword. Confirm the path with `ls`; for a keyword, search `docs/`, `README*.md`,
`commands/`, `agents/`, and `codex/` with `rg`. If no target or owner can be
identified, stop with `## Gate: Need Human`, explain the missing decision, and
do not create a guessed file.

```bash
ls "$ARGUMENTS" 2>/dev/null
rg -n -i --glob '*.md' "$ARGUMENTS" docs README*.md commands agents codex
```

Record the exact target files and whether the English and
`*.zh-TW.md` counterpart both need review. A single writer owns each shared
document pair; do not have parallel workers edit the same file.

### 2. Inspect the live implementation

Start from the current checkout and its dirty-worktree inventory. For a symbol,
class, method, or call relationship, use `cx overview <file>` first, then
`cx definition` and `cx references`; use `rg` or a focused `Read` only when cx
cannot answer. For a workflow or cross-file flow, use the GitNexus query/context
surface when available. Fall back to narrow `rg`, `git log`, and `git diff`
evidence when those tools are unavailable.

Do not infer facts from an old branch, an unresolvable `sourceCommit`, or a
generated projection without checking its canonical owner. Capture the relevant
file, symbol, route, manifest entry, command flag, or test as evidence.

### 3. Map facts to the owning document

Build a small before/after table before editing:

| Area | Current evidence | Document consequence |
|---|---|---|
| Entry / route | command, route rule, invocation class | update the user entry point and direct-invocation boundary |
| Workflow | implementation flow, agent handoff, flags | update the shortest primary path and link branch mechanics |
| Completion | test, receipt, sentinel, or harness outcome | state the observable PASS, `NOT_RUN`, `BLOCKED`, or `NO_SHIP` boundary |
| Distribution | canonical inventory and projection/package contract | keep supported, experimental, and unavailable surfaces distinct |
| Locale | English document and Traditional Chinese pair | update both or explain the explicit follow-up |

Keep one meaning in one SSOT. A guide may summarize a contract, but it must link
to the route table, manifest, configuration, or harness document that owns the
details. Never invent framework-shaped paths; use the directories that exist in
this repository.

### 4. Apply the writing-for-agents checks

Before saving, verify all five checks from the repository guidance:

1. **Pointer** — trigger and nearest non-use boundary appear before detailed mechanics.
2. **Hierarchy** — the main user path is local; branch-only details are linked or co-located once.
3. **Completion** — the document names observable evidence, handoff state, and plan/apply/archive boundaries.
4. **Pruning** — stale aliases, duplicate prose, cache paths, and no-op instructions are removed.
5. **Boundary** — invocation class, route target, flags, tool/model support, precedence, and support tier remain exact.

For user guides, prefer a decision ladder, an entry table, exact command
examples, and one next action. For agent or command docs, prefer an explicit
contract, non-use boundary, evidence checklist, and failure/handoff output.

### 5. Edit documentation only

Preserve unrelated dirty WIP. Before editing, save `git status --short` and a
targeted diff summary. During the edit:

- update the English/Traditional Chinese pair together when both exist;
- retain links to canonical files instead of copying implementation policy;
- preserve command namespaces (`/dhpk:...`, `$dhpk:...`) and exact flags;
- do not commit, stage, push, reset, stash, or overwrite unrelated changes;
- do not change source, tests, manifests, route rules, or generated projections.

### 6. Validate and hand off

Run the smallest relevant checks first, then the repository documentation and
route validators. At minimum, use the focused contract test and the existing
parity/frontmatter checks when those files are in scope. Confirm every new
relative link resolves, both locales keep heading and command-shape parity, and
the diff contains documentation changes only.

Completion requires all of the following:

- the target document(s) and their locale pair are named;
- implementation evidence and the SSOT owner are listed;
- validation commands have an exit result, or are explicitly `NOT_RUN` with a reason;
- unresolved work is `BLOCKED`/`Need Human`, not silently omitted;
- the handoff ends with exactly one recommended next command.

## Output

```markdown
# Document Update Report

## Scope
- Requested target: <path or keyword>
- Changed docs: <paths>
- Unchanged dirty WIP: <paths preserved>

## Evidence
- Implementation / route / manifest: <file:line or command>
- SSOT owner: <path>
- Locale pair: <English and Traditional Chinese status>

## Validation
- <command>: PASS | NOT_RUN | BLOCKED
- Link / heading / command parity: PASS | BLOCKED
- Source diff unchanged: PASS | BLOCKED

## Handoff
- Next command: `<one command>`
- Remaining blocker: <none or exact reason>
```

If target discovery, evidence, or validation is blocked, return the same report
with `## Gate: Need Human` or `BLOCKED` and the exact decision required. A green
documentation validator does not prove a source change, live consumer, release,
or archived OpenSpec change.
