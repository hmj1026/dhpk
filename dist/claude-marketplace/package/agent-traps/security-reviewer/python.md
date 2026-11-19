# Python security review traps

Use configured project instructions and the declared Python runtime floor. This guidance is host-neutral; use optional security guidance only when it is available. Review an evidenced trust path rather than flagging a function name by itself.

## Trace untrusted input to SQL

**Trigger:** Request data, files, environment values, queue messages, or model output reach SQL construction or execution.

**Check and act:** Record the source, transformations, and query sink. Verify that values are bound through the project’s database driver; separately review dynamic identifiers or query fragments against an allowlist. Python’s SQLite documentation shows placeholder binding for values; use the configured driver’s own rules. [SQLite placeholders](https://docs.python.org/3/library/sqlite3.html#how-to-use-placeholders-to-bind-values-in-sql-queries)

**Do not apply when:** The query is fixed and no untrusted value reaches its structure or parameters. Do not treat the presence of string formatting alone as proof without following the value to execution.

## Trace input to process execution

**Trigger:** Untrusted values reach subprocess, shell helpers, or another process-launch boundary.

**Check and act:** Establish whether a shell is invoked, which argument receives each value, and what authority the child process has. Prefer an argument sequence and fixed executable when compatible with the project contract; review quoting and allowlists when shell semantics are required. Python’s subprocess documentation warns that explicit shell invocation makes quoting the application’s responsibility. [Subprocess security considerations](https://docs.python.org/3/library/subprocess.html#security-considerations)

**Do not apply when:** The command and arguments are fixed by trusted code and no untrusted data influences process selection or behavior.

## Trace paths and file access

**Trigger:** A request, upload, archive entry, environment value, or generated identifier influences a filesystem path.

**Check and act:** Follow the value into reads, writes, includes, or deletes. Verify that the resolved target remains within the intended directory and consider symlinks and races; string checks for parent-directory markers alone do not establish containment. Python’s Path.resolve() resolves symlinks and removes parent-directory components, which can help establish the path being checked. [Python pathlib resolution](https://docs.python.org/3/library/pathlib.html#pathlib.Path.resolve)

**Do not apply when:** The path is generated from a fixed, trusted identifier and cannot be influenced by an external caller.

## Trace input to dynamic code or deserialization

**Trigger:** Untrusted values reach eval, exec, dynamic imports, unsafe parser modes, or object deserialization.

**Check and act:** Identify the exact source and operation. Avoid executing or unpickling untrusted data; Python warns that malicious pickle data can execute code during unpickling. [Python pickle warning](https://docs.python.org/3/library/pickle.html)

**Do not apply when:** The data is demonstrably produced and protected within a trusted boundary, and that trust assumption is part of the reviewed contract.

## Check secret and credential purpose

**Trigger:** Passwords, API keys, signing material, session identifiers, or bearer tokens are created, stored, transmitted, logged, or verified.

**Check and act:** Identify each value’s purpose and allowed use. Check that passwords use the project’s supported password-hash and verification path; tokens are checked against the intended issuer, audience, scope, expiry, and revocation rules; and secrets do not enter logs or public responses. Do not infer purpose from a variable name alone.

**Do not apply when:** The value is public configuration with no secret or credential role. Do not prescribe an algorithm or token format without the project’s runtime and authentication contract.

## Handoffs

**Trigger:** The trust path depends on database behavior, a framework lifecycle, or prompt/tool instructions.

**Check and act:** Send query, transaction, or storage details to database-reviewer. For FastAPI security paths, load [this role's FastAPI traps](fastapi.md); hand general lifecycle quality findings to code-reviewer with [its FastAPI traps](../code-reviewer/fastapi.md). For prompt content or tool-boundary behavior, use the shared [prompt-defense guidance](../_common/prompt-defense.md).

**Do not apply when:** The evidence can be resolved within the language-level path already in scope.
