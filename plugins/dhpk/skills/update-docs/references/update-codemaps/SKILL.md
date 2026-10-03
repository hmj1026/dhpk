---
name: update-codemaps
description: 'Use after a structural change or for an explicit architecture-document refresh. Not for rewriting application source or updating user documentation outside codemaps. Output: changed $PROJECT_DIR/docs/CODEMAPS paths, scan metadata, diff percentage, and PASS, BLOCKED, or confirmation-required status.'
allowed-tools: 'Read, Grep, Glob, Bash, Write, Edit'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Update codemaps

Scan the live project structure and create or refresh token-lean architecture
documents under `$PROJECT_DIR/docs/CODEMAPS/`. The workflow is
documentation-only. A
registered `doc-updater` role may run it after a structural change; direct use
is the manual refresh path. If no such role is registered, continue in the
current context rather than inventing one.

`$PROJECT_DIR` denotes the consumer project root in path examples. It is
notation for that root, not a required ambient environment variable. The live
tree is the consumer input; codemaps and `$PROJECT_DIR/.reports/codemap-diff.txt`
are outputs under that root.

## When NOT to Use

- The request is to update user or agent guides: use `$update-docs`.
- Application source, tests, manifests, route rules, or runtime projections
  need editing: stop and hand off to their owner.
- An existing codemap would change by more than 30% without confirmation:
  report `BLOCKED`/confirmation-required and do not overwrite it.

## Workflow

1. **Scan the project.** Detect the actual framework, layering, monolith or
   monorepo shape, and entry files. Inspect the live directory tree with native
   `ls`, `find`, `rg`, and reads. Typical paths are controllers, models, views,
   commands, services, repositories, and frontend assets, but add or remove
   categories based on what exists. Record the entry points such as
   `index.php`, `public/index.php`, `src/main.ts`, `manage.py`, or the actual
   project equivalent.
2. **Generate the five maps.** Create `$PROJECT_DIR/docs/CODEMAPS/` when absent, then create
   or update only these files:

   | File | Required coverage |
   | --- | --- |
   | `architecture.md` | High-level system diagram and real call/layer path |
   | `backend.md` | Controller actions, services, repositories, workers |
   | `frontend.md` | Frontend tree, APIs/namespaces, views and scripts |
   | `data.md` | Main tables, models, and relationships |
   | `dependencies.md` | External APIs, services, extensions, package deps |

   Keep each map below 1000 tokens. Prefer paths and signatures over code
   blocks, and use concise ASCII data-flow diagrams when useful. Replace every
   placeholder with a name observed in this checkout; do not publish a generic
   example as project fact. Record a service-locator definition before using
   it as a call-path entry, list frontend global namespaces with their files,
   and note framework conventions (such as Yii `protected/`, Rails `app/`, or
   Django app modules) before project-specific paths.
3. **Check the diff.** When maps already exist, compute the changed percentage
   per file and overall. A change at or below 30% may be written directly. A
   change above 30% requires the user’s confirmation before overwrite; show a
   concise diff summary and stop if confirmation is absent.
4. **Stamp and report.** Add a top comment to each map with generation date,
   scanned-file count, and estimated token count. Create
   `$PROJECT_DIR/.reports/` when absent and write
   `$PROJECT_DIR/.reports/codemap-diff.txt` with added/deleted/modified
   files, newly observed external dependencies, architecture changes, and
   documents older than 90 days.

## Output

Return:

```markdown
## Codemap Update

- Status: PASS | BLOCKED | CONFIRMATION_REQUIRED | NOT_RUN
- Scanned files: <count>
- Changed codemaps: <paths>
- Diff: <percentage and per-file summary>
- Report: `$PROJECT_DIR/.reports/codemap-diff.txt`
- Confirmation still required: <none or exact files/reason>
```

`PASS` means the scan, permitted writes, metadata, and report were verified.
Do not claim a generated map when scanning or generation failed.

## Verification

- [ ] The framework, directory layers, and entry points came from the live
      checkout rather than placeholders.
- [ ] Only the five codemap files and `$PROJECT_DIR/.reports/codemap-diff.txt`
      were written.
- [ ] Every map has generation date, scanned-file count, and token estimate.
- [ ] Every overwrite above 30% has explicit confirmation, or remains
      `CONFIRMATION_REQUIRED`/`BLOCKED`.
- [ ] Changed paths, diff percentage, report path, and any required follow-up
      are in the output.

## References

- Native `ls`, `find`, `rg`, `git diff`, and file reads are the portable scan
  and diff tools.
- When present, `$PROJECT_DIR/docs/agent-guidance/command-contract.md` supplies
  shared failure/output vocabulary; the status boundary above remains local so
  this skill can run in a consumer without repository guidance files.
