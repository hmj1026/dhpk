# Codex project setup adapter

This reference is the Codex branch of `harness-setup`. It delegates to the
receipt-aware project installer copy kept beside this Skill; it does not
translate Claude hooks, rules, settings, or prompts into a guessed Codex
equivalent.

The adapter requires an explicitly supplied dhpk distribution source artifact,
not the Skill directory or an ambient checkout. The installed Skill must first
contain these physical local executables:

- `$SKILL_DIR/scripts/install-codex-project.sh` — wrapper and argument
  boundary.
- `$SKILL_DIR/scripts/lib/install-codex-skills.sh` — synchronized local
  projection writer executed by that wrapper.

The declared artifact then supplies data only:

- <source-artifact>/codex/ — the source projection selected by that writer.
- <source-artifact>/codex/config.toml.example — copied next to, never over, a
  user config.
- <source-artifact>/manifests/distribution-inventory.json and any selected
  profile or package metadata required by the writer.

The consumer owns `<project>/.codex/.dhpk-installed.json` as its schema-v3
ownership receipt. If a local resource or declared artifact payload is absent,
return `BLOCKED_RESOURCE_MISSING` and do not search outside the explicit
artifact. The current Host supplies the Codex context; there is no new
`--host` option. A fixture or static check does not prove Codex runtime
availability; an unprobed runtime remains `NOT_RUN`.

## Read-only planning and apply boundary

Resolve the consumer project root and inspect the existing receipt before any
write. The Skill-local wrapper supports the following safe delegation:

```bash
bash scripts/install-codex-project.sh \
  --source-artifact <distribution-root> --plan --json
bash scripts/install-codex-project.sh \
  --source-artifact <distribution-root> --update
```

Use `--plan --json` for `--show` and `--dry-run`; it is read-only. An `--update`
requires an explicit operator confirmation after the plan. Preserve the
receipt's existing profile/projection mode unless the operator explicitly
requests a supported profile migration. Pass `--force` only for the
installer's project-root heuristic; it never bypasses receipt ownership or
path-safety checks.

The installer records managed skills, agents, and supporting assets in the
schema-v3 receipt. Existing user files, edited or retargeted entries,
unowned paths, malformed receipts, and collisions are preserved and reported.
`--uninstall` is ownership-aware and is not implied by setup. Never delete the
whole `.codex` directory or overwrite `.codex/config.toml`.

## Claude-only options

The public argument grammar remains shared so the command and Skill keep their
stable interface. On Codex, these options have no safe equivalent:

- `--install hooks|rules|scripts|all` — Claude asset groups; do not copy them
  into `.codex` or reinterpret them as a skill profile.
- `--review-gate` — Claude's local Review Gate initializer and trust-key flow;
  Codex setup does not fabricate it from a different hook contract.

Report each as `UNAVAILABLE` with the unsupported option and the Skill-local
Codex installer command as the next action. An unsupported Claude option is
not a successful no-op. Do not ask for Claude `userConfig`; Codex has no
equivalent. Project `config.toml` remains user-owned and is changed only by
the documented Codex configuration workflow.

## Output and verification

Return one receipt-bound report:

```text
Codex → plan/update/unsupported → created/updated/preserved/collision paths
Receipt → .codex/.dhpk-installed.json (schema-v3 or NOT_CONFIGURED)
Evidence → PASS | BLOCKED | UNAVAILABLE | NOT_CONFIGURED | NOT_RUN
Next action → one explicit installer or manual configuration step
```

Do not call the Codex CLI's plugin-management commands as proof that a
project-local skill is callable. A current receipt proves installation shape;
fresh Codex runtime discovery remains `NOT_RUN` until a consumer probe.

- [ ] Plan ran before any approved update.
- [ ] Receipt ownership and preserved conflicts were reported.
- [ ] No Claude hook/rule/Review Gate behavior was silently translated.
- [ ] User config and unrelated `.codex` files were preserved.
- [ ] Runtime availability was not inferred from static receipt evidence.
