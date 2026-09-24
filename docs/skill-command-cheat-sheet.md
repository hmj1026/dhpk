# dhpk Skill and Slash Command Cheat Sheet

> **Languages**: **English** · [繁體中文](./skill-command-cheat-sheet.zh-TW.md)
>
> Installation and support status: [platform installation SSOT](./platform-installation.md)

Use this page to choose an entry point. The inventory and generated Codex
usage catalog remain authoritative for availability and argument grammar.

## The four default capabilities

A clean Claude `minimal` installation exposes exactly these public skills:

| Capability | Use it when | Output / stopping boundary |
|---|---|---|
| `flow-guide` | You need help, routing, policy, the next step, or closeout advice | Read-only guidance or one bounded eligible handoff; never implements an explicit-only target |
| `code-trace` | You need to explore code, diagnose a failure, inspect history, or select a navigation tool | Evidence-backed trace or an explicit blocker; does not apply a fix |
| `flow-drive` | The specification or change is already confirmed | Workspace implementation and verification; stops on missing authority, unresolved gates, or scope expansion |
| `change-verdict` | You need a read-only verdict on code, PRs, security, tests, docs, or risk | Findings plus `READY`, `BLOCKED`, or `INCONCLUSIVE`; never edits the reviewed scope |

`git-smart-commit`, full TDD guidance, project audit, prompt optimization, and
stack-specific skills remain optional capabilities. They are not silently
re-added to `minimal`.

## Host syntax and availability

| Host | First check | Boundary |
|---|---|---|
| Claude Code | `/dhpk:flow-guide help` | Recommended clean install: `bash scripts/install.sh`; start a new session after installation |
| Codex CLI | `$flow-guide help` | The generated catalog lists the actual Codex surface; `change-verdict` is currently `not-codex-invokable`, not an alias |
| Cursor | Reload the selected Agent Plugin or project-local projection, then verify discovery | Structure or installation is not runtime proof; record unavailable client evidence as `NOT_RUN`, `BLOCKED`, or `UNAVAILABLE` |
| AGY | `agy agents` after receipt-owned installation | Native load evidence is separate from runtime execution; no direct skill syntax is claimed without a passing client probe |

## Find and add optional capabilities

- Codex: `$flow-guide help` lists installed Codex-invokable skills. A
  project-local projection can preview an additive skill with
  `install-codex-skills.sh --plan --json --skill <stable-id>` and apply it with
  the same `--skill` plus the appropriate install/update action.
- Claude: generate a standalone package with
  `node scripts/ci/gen-claude-profile-bundles.js --standalone <stable-id>`.
  This is a checkout/development route; the generic `dhpk-install` writer is
  still `BLOCKED` with `NOT_IMPLEMENTED`.
- Cursor and AGY: use the inventory-selected package for that surface. Dynamic
  per-skill writes are not documented unless the surface adapter implements
  them.

## Common workflow entries

```text
$flow-guide route <task>
$flow-guide route --go <task>
$code-trace --mode=diagnose <failure>
$flow-drive <confirmed-spec-or-change-id>
/dhpk:review-pending
```

Proposal authoring belongs to the external `$openspec-propose` owner. Git,
release, setup, review, and maintenance slash commands are listed in
[`commands/INDEX.md`](../commands/INDEX.md).

## Retired names and rollback

The current release does not publish invocation aliases for retired skills,
agents, or commands. A dhpk-owned seam may return a retirement or rename
diagnostic; direct Host invocation may return its own unknown-skill response.
Use the [migration guide](./skill-platform-migration.md) for successor mappings
and receipt-bound rollback. Do not recreate an old alias in the current
package.

## Evidence boundary

The canonical profile is `minimal`, which selects exactly the four capabilities
above; `full` and `compat-v1` remain explicit opt-ins. Check a profile's
selection with `node scripts/ci/gen-claude-profile-bundles.js --profile <id> --plan`
and a generated package's selection in its `provenance.json`
(`selectedSkillIds`). The Cursor native overlay shares the Agent Plugin skills.
These are structural/package facts, not runtime `PASS`. Report unavailable
probes as `NOT_RUN`, `BLOCKED`, or `UNAVAILABLE`.
