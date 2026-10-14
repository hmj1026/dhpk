# Claude Code parent-session CLI dispatch

Use this branch when Flow Drive selects a Codex worker or reasoner on Claude
Code. The parent session launches the bundled CLI runtime through Bash; it
does not send a transport environment variable through the Agent tool.

The short invocation uses the dispatcher's resolved configuration:

```text
/dhpk:flow-drive <change> --worker=codex --reasoner=codex
```

Use `--reasoner=codex/gpt-6.1-sol:high` to override the configured reasoner
model and effort. `codex-cli` remains a compatibility spelling of `codex`.
An explicit worker target overrides the worker selector. Explicit selection
does not require `--cross-provider`; in this Host procedure, that flag permits additional automatic candidates
under the execution policy and current access checks. The programmatic
[portable runner](portable-runner.md) instead uses it to open a provider-scope
question; neither path grants workspace or external-action authority.

## Dispatcher packet

Resolve the confirmed change, current Host profile, configuration layers,
assigned files and verification command before launching. Preserve the parsed
invocation object from step 0. Write a private, regular JSON packet for each
role beneath the project's attempt artifact directory, then run:

```bash
node "<this Skill directory>/scripts/launch-dispatch.js" --packet "<absolute packet path>"
```

The packet contains:

- `change`: `{ "confirmed": true, "change_id": "<step 0 identifier>" }`.
- `invocation`: the unmodified step 0 parser result.
- `role`: `reasoner` or `worker`.
- `host_profile`: the current profile, including actual provider access
  evidence. Bundled `NOT_RUN` access remains `NOT_RUN`; never replace it with
  `AVAILABLE` merely because a flag was supplied. A bounded CLI/version and
  authentication check may establish local transport availability; report
  model rejection or authentication failure from the actual launch.
- `task_id` and `attempt_id`: explicit identifiers for this role attempt.
- `workdir` and `prompt`: absolute project and self-contained prompt paths.
- `scope`: explicit `artifact_root`, `context_path`, `receipt_path`,
  `assigned_files`, `report_only: true`, and restricted `runtime_path` values.
  `report_only` describes scope observation; worker authority still comes
  from its `workspace-write` role.
- `config`: project-over-global resolved role configuration, with canonical
  `codex_worker_model`, `codex_worker_effort`, `codex_worker_timeout_secs` or
  corresponding `codex_reasoner_*` values. Resolve shipped defaults through
  the selected installation's configuration before writing the packet;
  normalize the timeout to an integer, including an explicit `0` for no deadline.
- `reasoner_result`: required on a worker packet when a reasoner was requested;
  its `status` must be `READY_FOR_DISPATCH` and `evidence` must identify the
  observed conclusion and receipt. The parent checks the conclusion contract
  before attesting this result.

Use a fresh attempt directory, context path, and receipt path for each role
and retry. Scoped preparation of these inputs is part of this CLI dispatch
procedure and is allowed before the launch command. For example, under the
authorized project artifact scope:

```bash
mkdir -p "<project root>/.dhpk"
mkdir -m 700 "<project root>/.dhpk/<new attempt id>"
```

Set `scope.artifact_root` to that new directory. The second command must succeed
as a fresh creation; inspect an existing path and choose a new attempt rather
than changing its permissions or overwriting earlier evidence. Write the
self-contained prompt and dispatcher packet inside this directory. Packet and
prompt must be regular, non-symlink files; they do not require exact `0600`
modes because the containing directory already restricts access.

Supply `scope.context_path` and `scope.receipt_path` as fresh absolute paths
inside `scope.artifact_root`, but leave both target files nonexistent. The
launcher creates the immutable `0600` transport context and binds the resolved model,
effort, timeout, prompt, runtime and authority. Preserve its context and
terminal receipt as evidence; do not reuse or overwrite an earlier attempt.
The dispatcher prepares trusted runtime entries for `codex`, `python3`, and
`bash`, using the contained runtime's existing trust checks. Supply at most
three physical absolute directories, not the ambient `PATH`; omit symlinked
directory aliases such as `/bin` when its physical location is `/usr/bin`.

## Ordering and completion

Run the requested reasoner first in `read-only` mode. Check its actual
`Reasoner result`, conclusion, file evidence and next actions under the
execution policy. A failed launch, missing conclusion or non-ready result
stops the worker. Then launch the worker in `workspace-write` mode within its
assigned scope. Native planner and architect consultations remain owned by
the parent session and retain their prerequisite gates.

The CLI exit status and terminal receipt establish execution, not completion
of the change. Independently run the assigned verification and inspect the
assigned diff before reporting `PASS`. Report model/auth/tool failures as
`BLOCKED`, timeouts through the existing reconciliation policy, and real Host
or model checks that were not run as `NOT_RUN`. The launcher performs no
automatic provider fallback.

## Permission failures

A `0600` diagnostic identifies a private transport file check, not Codex model
access. Keep the exact error and stage in the report:

- `artifact_root must remain private while pinned`: the artifact directory
  is accessible to group or other users. Start a fresh `0700` attempt directory
  using the preparation above.
- `physical temporary file is not a private regular file`: context creation
  failed before Codex started. The launcher must set `0600` on its newly opened
  descriptor even when inherited `umask` masks owner bits. Preserve failed
  attempt evidence and use a fresh attempt with the corrected runtime.
- A transport context mode, identity, or symlink rejection: preserve the
  rejected context and receipt; confirm the packet points to the fresh
  launcher-owned context. Do not create or chmod a context manually.

Local fixture verification uses a Codex stub and proves the launcher contract;
it does not establish real Claude permission approval, Codex authentication,
or Provider execution.
