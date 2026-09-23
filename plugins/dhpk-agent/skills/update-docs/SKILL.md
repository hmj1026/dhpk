---
name: update-docs
description: "Use when a live route, setup, distribution, configuration, or bounded workflow change makes user or agent documentation stale. Not for source/test edits, codemap-only refreshes, policy review, or external-library research. Output: an evidence-backed document update report with PASS, NOT_RUN, BLOCKED, or Need Human handoff."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Documentation update

Refresh Markdown and other documentation from the current checkout. `$ARGUMENTS`
is either an existing documentation path or a workflow keyword. This skill may
write documentation only; it does not edit application source, tests, route
tables, manifests, or generated runtime projections.

`$PROJECT_DIR` denotes the consumer project root in path examples. It is
notation for that root, not a required ambient environment variable. The target,
evidence, and canonical owners below are consumer project paths; resolve the
actual `$ARGUMENTS` from the invocation and keep the documented output boundary.

## When NOT to Use

- Codemap generation is the goal: use `$update-codemaps`.
- A policy, link, or frontmatter verdict is needed: use a read-only document
  review workflow.
- External-library research is needed: use the repository’s documentation
  lookup workflow.
- The target owner or locale pair is ambiguous: stop with `Need Human` rather
  than creating a guessed file.

## Workflow

1. **Bound the target.** For a path, confirm it with `ls`; for a keyword, use
   `rg -n -i --glob '*.md'` across `docs/`, `README*.md`, `commands/`,
   `agents/`, and `codex/`. Record exact targets and whether an English and
   `*.zh-TW.md` pair both need review. One writer owns each shared pair.
2. **Inspect live evidence.** Record `git status --short` and a targeted diff
   before reading. For a symbol or call relationship, use `cx overview`, then
   `cx definition`/`cx references` when those commands exist; for workflows,
   use GitNexus query/context when available. Fall back to narrow `rg`, file
   reads, `git log`, and `git diff`. Verify canonical owners rather than
   promoting a stale branch or generated projection to truth.
3. **Map facts to owners.** Build a before/after table covering entry/route,
   workflow and handoffs, completion evidence, distribution, and locale. Keep
   one meaning in one SSOT and link or name that owner instead of copying its
   policy.
4. **Apply the writing checks.** Put the trigger and nearest non-use boundary
   first; keep the primary path local; disclose branch-only mechanics once;
   state observable `PASS`, `NOT_RUN`, `BLOCKED`, or `NO_SHIP`; prune stale
   aliases, duplicate prose, cache paths, and no-op instructions; preserve
   exact command namespaces, flags, invocation classes, tool/model support, and
   precedence.
5. **Edit documentation only.** Update the English/Traditional Chinese pair
   together when both are owned by this request. Preserve unrelated dirty WIP.
   A registered `doc-updater` role may own a structural handoff; if no such
   role is available, perform this bounded workflow in the current context.
6. **Validate and hand off.** Run the smallest focused documentation/parity,
   frontmatter, route, and link checks available. Confirm changed links resolve,
   locale headings and command shapes agree, and no source file changed. End
   with exactly one recommended next command. A skipped check is `NOT_RUN`.

### Canonical owners

When these paths exist in the consumer checkout, consult them as owners rather
than duplicating their facts. If a consumer lacks one, state that evidence gap
and use the available local owner; never invent a replacement path.

| Fact | Preferred owner |
| --- | --- |
| Public names, surfaces, counts | `$PROJECT_DIR/manifests/distribution-inventory.json` |
| Route matching and invocation class | `$PROJECT_DIR/skills/flow-guide/references/route-table.json` and `$PROJECT_DIR/skills/flow-guide/scripts/route-result.js` |
| Effective configuration | `$PROJECT_DIR/docs/configuration.md` and its Traditional Chinese pair |
| Install, update, migration, rollback | `$PROJECT_DIR/docs/platform-installation.md` and `$PROJECT_DIR/docs/skill-platform-migration.md` |
| Runtime workflow, receipts, gate outcomes | `$PROJECT_DIR/docs/harness-workflow.md` and owning harness scripts |
| Agent-writing rules | `$PROJECT_DIR/docs/agent-guidance/writing-for-agents.md` |

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

If discovery, evidence, or validation is blocked, retain the same report and
add `## Gate: Need Human` with the exact decision required. Do not claim source
implementation, release, deployment, archive, or OpenSpec completion.

## Verification

- [ ] The target and any locale pair are named and owned.
- [ ] Each normative claim has live implementation evidence and an SSOT owner.
- [ ] Documentation-only scope is proven; unrelated dirty WIP is preserved.
- [ ] Every validation command has an exit result or an explicit `NOT_RUN`
      reason, and unresolved work is `BLOCKED`/`Need Human`.
- [ ] The report ends with exactly one recommended next command.

## References

- Native `ls`, `rg`, `git`, `cx`, and GitNexus checks are optional evidence
  sources; use the strongest available source and label fallbacks.
- The local writing contract is the five-check sequence above. A consumer may
  additionally consult `$PROJECT_DIR/docs/agent-guidance/writing-for-agents.md`,
  `$PROJECT_DIR/docs/agent-guidance/command-contract.md`, or
  `$PROJECT_DIR/rules/execution-policy.md` when those repository-owned files are
  present.
