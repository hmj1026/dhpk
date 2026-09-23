# Claude Code setup adapter

This reference is the Claude branch of `harness-setup`. Load it only after
the current Host has been identified as Claude. The procedure remains
Host-driven: detection, questions, rendering, and settings writes are
instructions for the active Claude Host. An unprobed Host run remains
`NOT_RUN`; this reference does not manufacture Host evidence.

The installed Skill contains its executable adapter and local procedure
resources. Native packaging supplies a distribution artifact explicitly when
asset bytes are needed. Require these resources:

- `data/module-catalog.json` — stack, version, review-slot, and hook
  profile source of truth.
- `scripts/install-assets.sh` — Skill-local deterministic asset adapter.
- `scripts/review-gate-runtime.js` — Skill-local Review Gate initializer.
- `templates/settings.local.json.example` — settings shape guidance.

A missing local resource is `BLOCKED_RESOURCE_MISSING`. Do not search a
plugin cache, consumer `.claude`, parent checkout, or a remote URL to replace
it. The maintained writer is read only as artifact data at
<source-artifact>/scripts/setup/install-assets.sh; synchronization places its
bytes at $SKILL_DIR/scripts/lib/install-assets-writer.sh.

## Root and existing state

1. Resolve the consumer root with `git rev-parse --show-toplevel`, falling back
   to `pwd` outside a Git repository.
2. Read `.claude/settings.local.json` if it exists. Preserve unknown keys and
   the existing configuration shape; current installations commonly store
   options under `pluginConfigs["dhpk@dhpk"].options`. Never invent a second
   namespace when an existing shape is present.
3. `--show` prints the effective values and exits. It never prompts or writes.

## Asset installation

For `--install hooks|rules|scripts|all`, require an explicit
`--source-artifact <distribution-root>`, then run the Skill-local adapter before
any configuration question and stop:

```bash
bash scripts/install-assets.sh \
  --source-artifact <distribution-root> \
  --target <project-root>/.claude/dhpk \
  --install <hooks|rules|scripts|all> [--dry-run] [--force]
```

The adapter prints a structured result containing `status`, `code`, the
physical artifact and target, operation flags, and the Skill-relative writer.
The artifact is read as data; an installer beneath it is never sourced or
executed. `--dry-run` writes nothing; identical files are skipped; differing
files are conflicts unless the operator explicitly supplied `--force`; and
executable bits are retained.
Any destination path with a symlink component is rejected even with `--force`.
Do not combine this operation with interactive reconfiguration or claim a write
from a plan.
Real installation requires Python 3 with the physical descriptor capabilities
used by the writer; if unavailable, installation stops before target mutation
with exit 2. `--dry-run` remains available without Python 3.

## Review Gate initialization

`--review-gate` performs setup only. Run the dependency-free initializer with
the operator-supplied public key and independently supplied fingerprint:

```bash
node <resolved-package-root>/scripts/review-gate-runtime.js \
  init --repo-root <project-root> \
  --host-public-key <operator-supplied-public-key-path> \
  --host-key-id sha256:<64-lowercase-hex>
```

Require exit `0` and JSON `schema: "dhpk.review-gate.runtime.v1"` with
`command: "init"`. The initializer creates or retains
`.dhpk/review-gate/v1/integrity.key` as a regular `0600` file. A regular
existing key is retained and reported as already initialized; it is never
overwritten. The public-key path must be regular, private (`0600`), and free
of symlinked components; its bytes must match the supplied fingerprint.
Missing, malformed, unsafe, or mismatched trust is a setup error. Never print
private key material or lazily generate either key from another Review Gate
operation. Later prepare, reviewer dispatch, and observe calls remain owned by
the Application Session.

## Interactive configuration

After the plugin is installed, use one native `AskUserQuestion` call per
logical step. Do not ask these questions in free-form prose:

1. **Stacks** — multi-select `.stacks[].id` from the catalog; empty means
   generic core only.
2. **Per-stack version** — respect `.selection` (`exclusive` by default,
   `additive` for cumulative library guidance). Resolve each selected
   `.module` and auto-include its `requires_module`. Under additive selection,
   an `.exclusive: true` version drops sibling selections and surfaces a
   warning.
3. **Docker** — ask about container names only after explicit opt-in to the
   separate Docker workflow. Explain that Docker must be installed and the
   operator must provide the intended container names; `/dhpk:setup` does not
   register a Docker SessionStart check. Keep Docker setup outside this Skill's
   automatic writes.
4. **Review agents** — offer overrides for the seven slots: code, database,
   security, frontend, doc, polyfill, and migration. Pad short overrides with
   shipped defaults.
5. **Hook profile** — single-select `minimal`, `standard`, or `strict` from
   `.hook_profiles[].id`.

Write the resolved values under the existing local settings/userConfig shape,
preserving unrelated settings. Show a before/after diff. Module changes need
the normal Claude plugin reload (`/plugin configure dhpk@dhpk` or the documented
terminal uninstall/install equivalent); settings-only changes apply next
session. `--review-gate` does not alter Review Gate authority.

## Output and verification

Return a confirmation block containing `modules`, `docker_containers`,
`review_agents`, `hook_profile`, and `review_gate`, each with before/after
values, followed by exactly one next action. Mark missing dependencies or
unsupported operations `UNAVAILABLE`/`BLOCKED`; never turn a skipped prompt
into a successful configuration.

- [ ] Catalog was read as the only source for stacks, versions, slots, and
      hook profiles.
- [ ] Existing settings and unknown keys were preserved.
- [ ] Asset-install and Review Gate exit/JSON evidence was recorded when used.
- [ ] The active Host's detection/render capability remains `NOT_RUN` until a
      supported Host probe supplies evidence.
- [ ] No private key, credential, or user-owned file was printed or replaced.
