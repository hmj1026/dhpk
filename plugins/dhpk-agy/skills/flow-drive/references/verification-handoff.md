# Verification after a writer handoff

Run downstream verification only after the assigned writer reports
`RESULT: DONE` and provides a receipt for the exact assigned-file snapshot. The
receipt is a completion artifact; it does not grant authority or prove a review
verdict.

Use this JSON shape:

```json
{
  "status": "DONE",
  "files": {
    "relative/path/to/changed-file": "<64-character SHA256 hex>",
    "relative/path/to/deleted-file": null
  }
}
```

`files` must be a non-empty map. Paths are relative to the writer repository
root, use `/` separators, and name every assigned file, including files that
were deleted. A string value is the file's SHA256; `null` records an assigned
file that is absent. The parent passes its authoritative assignment separately
to the CLI with one `--assigned-file` option per path. The gate requires the
receipt keys to match that parent-provided set exactly, so the scope is never
derived from the receipt. A non-`DONE` status, missing receipt or assigned-file
input, invalid path, empty map, omitted or extra receipt path, or hash mismatch
stops before the downstream command starts.

Wrap the downstream command as an argv vector:

```text
node <Flow Drive skill directory>/scripts/verify-handoff.js \
  --root <writer-repository> \
  --handoff <receipt.json> \
  --assigned-file relative/path/to/changed-file \
  --assigned-file relative/path/to/deleted-file \
  -- <verification-command> [arguments...]
```

`--assigned-file` is mandatory and repeatable. Supply every path from the
parent's original assignment, including a path the writer deleted. The options
form an exact set comparison with `files`; receipt-only paths and assignment
paths missing from the receipt both fail closed. The CLI's `--help` option
prints usage and exits successfully.

Relative `--root` and `--handoff` paths resolve from the caller's current
working directory. The downstream command inherits that same working
directory, receives each argument literally, and runs without a shell. The
gate checks the receipt hashes before launch and checks them again after the
command finishes. A changed or unstable snapshot returns nonzero, even when
the downstream command exits successfully. Otherwise, the command's exit code
is preserved.

The gate detects observed changes; it does not lock the writer repository. If
the downstream command intentionally changes an assigned file, obtain fresh
completion evidence and a new receipt before the next verification run.
