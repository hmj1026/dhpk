---
name: harness-setup
argument-hint: '[--show] [--review-gate] [--source-artifact=<dir>] [--install=<group>] [--dry-run] [--force]'
description: 'Configure or inspect the dhpk harness, initialize its optional Review Gate, or install selected host assets. Not for: ordinary harness audits, application changes, or silent credential/configuration changes. Output: a host-specific setup report with preserved-file, receipt, and terminal evidence.'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# Harness Setup

`$harness-setup` is the explicit setup capability behind the Claude
`/dhpk:setup` front door. It owns setup and configuration evidence; it does not
silently broaden a host's authority or invent a second installer.

## When to Use

- The operator explicitly requests `$harness-setup` or `/dhpk:setup`.
- The operator wants to inspect effective setup with `--show`.
- The operator explicitly selects `--review-gate` or a host-supported asset
  installation group.

## When NOT to Use

- Harness health, budget, trimming, or cross-platform synchronization: use
  `harness-govern` and its selected mode.
- Application code, ordinary configuration edits, or credentials not covered by
  the host setup procedure.
- A request that supplies a new `--host` selector. Host is detected from the
  current runtime; do not add a public host flag.

## Host and resource resolution

1. Detect the current Host from the native invocation context and available
   tools. A Claude command context selects the Claude adapter; a Codex
   project-local skill context selects the Codex adapter. If the context is
   ambiguous, stop `BLOCKED` with `HOST_UNRESOLVED` rather than guessing.
2. Load exactly one package-local adapter reference: [Claude setup](references/claude-setup.md)
   or [Codex setup](references/codex-setup.md). A missing reference or declared
   runtime asset is `BLOCKED_RESOURCE_MISSING`; do not scan ambient checkouts or
   remote URLs for a replacement.
3. Preserve the caller's argument string. The accepted grammar is the
   `argument-hint` above; unknown options are `BLOCKED`. `--source-artifact`
   is explicit task input for asset or Codex installation; it is never inferred
   from a checkout, plugin cache, parent directory, or sibling Skill.

The adapter references, executable wrappers, and procedure resources are
Skill-local. `scripts/install-assets.sh` and
`scripts/install-codex-project.sh` resolve their physical helpers from their
own `BASH_SOURCE`; they execute no adapter selected from the source artifact.
The source artifact supplies bytes and manifests only. A missing local helper
is `BLOCKED_RESOURCE_MISSING`; a missing or invalid explicit artifact is
`SOURCE_ARTIFACT_REQUIRED` or `SOURCE_ARTIFACT_INVALID`.

## Workflow

1. Resolve the consumer project root and read current host state before any
   write. Existing settings, user files, receipt entries, and unrelated dirty
   work remain intact.
2. If `--install` is present, run the local asset adapter with the explicit
   source artifact before configuration questions, then report its result and
   stop. Do not combine asset installation with interactive reconfiguration.
3. If `--review-gate` is present, run only the host-supported Review Gate setup
   operation. Initialization is not reviewer dispatch, approval, or a later
   lifecycle observation.
4. If `--show` is present, display effective current state and stop without
   questions or writes. Otherwise follow the selected adapter's configuration
   flow, using its native prompt mechanism when available and a visible
   confirmation boundary before writes.
5. Verify the resulting state from the host's authoritative settings or
   receipt. Keep `PASS`, `BLOCKED`, `UNAVAILABLE`, `NOT_CONFIGURED`, and
   `NOT_RUN` distinct; a planned or skipped operation is not a pass.

## Output

Return one report with:

```text
Host → operation/arguments → planned/applied/preserved/unsupported items
Evidence → PASS | BLOCKED | UNAVAILABLE | NOT_CONFIGURED | NOT_RUN
Next action → exactly one host-appropriate follow-up
```

For a write-capable run, include the target root, changed paths, preserved
conflicts, receipt or settings evidence, and the command/exit result. Redact
keys, tokens, and credentials. Never claim that an installation happened when
only a plan or structural receipt was observed.

## Verification

- [ ] Host was detected without a new public host flag.
- [ ] Only the selected Skill-local adapter and its declared resources were
      loaded; artifact files were treated as data.
- [ ] Existing user files and unrelated receipt entries were preserved.
- [ ] `--install`, `--review-gate`, `--show`, and unsupported-option boundaries
      match the selected Host.
- [ ] The terminal evidence state and one next action are explicit.

## References

- [references/claude-setup.md](references/claude-setup.md) — Claude settings,
  `userConfig`, asset, and Review Gate behavior.
- [references/codex-setup.md](references/codex-setup.md) — Codex project
  installer, receipt ownership, and Claude-only option boundaries.
