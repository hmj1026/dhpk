# Flow Drive comparison fixtures

These are frozen, dependency-free Node.js consumer tasks for the bounded
comparison described by issue #1109. The initial projects and prompts are the
same in all three conditions; do not edit a fixture after observing any
comparison result. `manifest.json` pins the project hashes, tool versions, and
the one-run-per-cell limit.

## Reconstructing a cell

For each task/condition pair, create a fresh project copy and a fresh Codex
session. Keep the task prompt and `CONSUMER.md` unchanged. The allowed file for
each task is listed in the manifest. The independent reference answers and
oracle are siblings of `tasks/`, never copied into the consumer project.

```sh
fixture_root=tests/fixtures/flow-drive-comparison
task=receipt-quantity
cell_root="$(mktemp -d)/$task-native"
mkdir -p "$cell_root"
project="$cell_root/project"
cp -R "$fixture_root/tasks/$task/project" "$project"
```

Use one of these project-local conditions:

- `native`: leave the copied project free of dhpk skill or project guidance.
- `current`: use the pinned Codex-materialized artifact from
  `plugins/dhpk/skills/flow-drive` at commit
  `5440dc516a7ffd0b52620546bb8f106210e79ce4`, then copy it to
  `$project/.agents/skills/flow-drive`. This is the runnable Codex projection;
  its `metadata.dhpk-next` value is serialized as a string.
- `simplified`: after #1111 is complete, record its final integration commit
  and copy the raw canonical `skills/flow-drive` directory (not a generated
  Host projection) to the same project-local path.

The current and simplified conditions intentionally use distinct acquisition
shapes from the same versioned source workflow: the existing runnable Codex
artifact versus the future canonical skill directory. The source checkout,
sibling public skills, `oracle.js`, and `reference-answers/` must be unreadable
and unwritable from every task session. The comparison host retains the oracle
and reference answers outside the session and runs the oracle only after the
session ends. If the Host cannot enforce this isolation, leave that cell
`NOT_RUN` and record the limitation; do not treat the fixture copy alone as an
OS sandbox.

For example, materialize the current skill before starting the task session:

```sh
staging="$(mktemp -d)"
mkdir -p "$project/.agents/skills"
git archive 5440dc516a7ffd0b52620546bb8f106210e79ce4 \
  plugins/dhpk/skills/flow-drive | tar -x -C "$staging"
cp -R "$staging/plugins/dhpk/skills/flow-drive" \
  "$project/.agents/skills/flow-drive"
```

Do not add sibling skills or change the user-level Codex installation between
cells. Each cell uses the same Codex CLI, Provider, Model, effort, task prompt,
consumer instructions, and fixture hash. Start a new session for every cell;
do not retry a cell or compare against an earlier cell's workspace. Record
session identity, changed files, interventions, elapsed time, available token
usage, skill artifact shape, and the independent oracle result in a copy of
`record.template.json`.
The template contains exactly the nine permitted cells, all initially
`NOT_RUN`.

After the task session ends, run the evaluator from the repository checkout,
outside the consumer project:

```sh
node tests/fixtures/flow-drive-comparison/oracle.js \
  receipt-quantity /absolute/path/to/cell/project
```

Exit 0 means all task checks passed; exit 1 means at least one observable
expectation failed; exit 64 means the oracle invocation or candidate layout was
invalid. The test suite first proves that each frozen initial project is
rejected for its intended defect, then checks that a separate known-good
reference implementation passes. The oracle runs candidate Node code in a
timed child process. These behavioral fixtures are not an operating-system
sandbox; use disposable consumer workspaces with no sensitive files.

This ticket prepares inputs and does not run any Model task. All nine cells
remain `NOT_RUN` until the dependent comparison ticket.
