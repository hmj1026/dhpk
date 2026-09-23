# Consumer asset installation

Use `/dhpk:setup --install hooks|rules|scripts|all` for a deterministic copy
of dhpk assets into a consumer project. The deprecated `/install-hooks`,
`/install-rules`, and `/install-scripts` commands forward to that entry point.
When this phase performs a copy, the Host supplies an explicit distribution
artifact and invokes the Skill-local `scripts/install-project-assets.sh` adapter.

The local adapter reads selected artifact data and copies it to
`<project>/.claude/dhpk/`:

| Selection | Source | Target |
|---|---|---|
| `hooks` | `hooks/hooks.json` | `.claude/dhpk/hooks/hooks.json` |
| `hooks` | `scripts/hooks/` | `.claude/dhpk/scripts/hooks/` |
| `rules` | `rules/` | `.claude/dhpk/rules/` |
| `scripts` | `scripts/` | `.claude/dhpk/scripts/` (shared setup scripts) |
| `scripts` | `skills/precommit/scripts/` | `.claude/dhpk/skills/precommit/scripts/` |
| `scripts` | `skills/repo-verify/scripts/` | `.claude/dhpk/skills/repo-verify/scripts/` |
| `scripts` | `skills/harness-audit/scripts/` | `.claude/dhpk/skills/harness-audit/scripts/` |

It never edits `.claude/settings.json` or `.claude/settings.local.json`.
Consumers register any copied hook explicitly, using their own desired policy.
The default lifecycle consists of the pre-tool edit guard, pre-bash dispatch,
session-start, and subagent-stop surfaces present in the selected artifact;
project setup does not invent additional lifecycle hooks.

Run the adapter as follows when a group remains after mode short-circuiting:

```bash
bash scripts/install-project-assets.sh \
  --source-artifact <distribution-root> \
  --target <project-root>/.claude/dhpk \
  --install hooks|rules|scripts|all [--dry-run] [--force]
```

The artifact is data. The adapter executes only its adjacent synchronized
writer and reports a non-pass result before mutation for missing local helpers,
missing payload, unavailable Python descriptor capabilities, or conflicts.

Run with `--dry-run` to print source and target actions without writing. An
identical target is skipped; a different target is a conflict and the selected
group is left untouched unless the user explicitly requests `--force`.
For `scripts` and `all`, preflight verifies each runner tree before any target
mutation: the Skill runner, plus its adjacent `lib/runner-utils.js` helper for
`precommit` and `repo-verify` (`harness-audit` has no helper). The helper is copied beside its runner,
so runtime resolution stays within the installed Skill directory. Executable
source files are copied with their executable bit retained. Real installation
requires Python 3 with the physical descriptor capabilities used by the
writer; if unavailable, installation stops before target mutation with exit 2.
`--dry-run` remains available without Python 3.

The old exclusive destinations
`.claude/dhpk/scripts/precommit-runner.js`,
`.claude/dhpk/scripts/verify-runner.js`, and
`.claude/dhpk/scripts/harness-audit.js` are removed without compatibility
shims. If any of them exists, this installer has no ownership receipt for it:
preserve the exact file, report its path and the manual reconciliation action,
and abort preflight with exit 3 even when `--force` is supplied. A Skill-local
file with different content is reported as a conflict and preserved unless
`--force` is explicitly supplied. Per-Skill `skill-package.json` descriptors are retired: a Skill
directory is its complete package, and no installer reads a descriptor to find
Skill resources.
