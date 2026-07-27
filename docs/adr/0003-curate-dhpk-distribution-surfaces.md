# Curate dhpk distribution surfaces

Date: 2026-07-27
Status: accepted

## Context

dhpk has more than one way to reach consumers: Claude Code marketplace
installation, local source development, Codex project synchronization, a
Codex plugin marketplace wrapper, and Claude-first adapters for Gemini and
Antigravity. These paths do not have the same runtime guarantees or update
semantics.

The repository currently contains 105 canonical skill packages (68 root
packages and 37 module packages). The Codex projection contains 15 entries: 11
symlinked root projections and four documented physical module mirrors. All
canonical packages have Codex interface metadata, but that metadata does not
mean every package belongs in the Codex distribution subset.

Without an explicit policy, documentation can turn an experimental discovery
path into a supported install promise, or treat a platform adapter as native
parity. It can also make a mirror look like an independently maintained source.

## Decision

### 1. Support tiers are part of the public contract

| Surface | Tier | Contract |
|---|---|---|
| Claude marketplace | Supported | Primary consumer installation and update path. |
| `claude --plugin-dir` | Development-only | Working-tree iteration; not a release channel. |
| `scripts/install.sh` | Convenience wrapper | Uses the Claude marketplace contract; does not create a separate distribution. |
| `install-codex-skills.sh` | Supported | Stable Codex project sync path with explicit symlink/copy/update behavior. |
| Codex plugin marketplace | Experimental | May be tested, but plugin listing or installation does not prove runtime skill materialization. |
| Gemini and Antigravity sync | Adapter-only | Claude-first comparison/conversion path; no native package or full agent-parity promise. |

Documentation and release claims must preserve these tiers.

### 2. Canonical ownership is Claude-first

The canonical inventory is the set of packages under `skills/` and
`modules/*/skills/`. Claude-side content is the source platform for
cross-platform synchronization. Codex, Gemini, and Antigravity artifacts are
projections or adapters and must not become reverse-sync sources.

The Codex projection is not counted as a second canonical inventory. A
platform-specific metadata file describes discoverability; it does not change
package ownership or prove runtime compatibility.

### 3. Codex is an explicit subset

Codex exposes only an explicitly curated subset of canonical packages. New
entries require a portability review, a projection/layout check, and an
intentional allowlist change. Claude module activation is not silently
recreated as Codex behavior because Codex has no equivalent module-selection
contract.

Equivalent root packages use relative symlinks. Physical Codex mirrors are
limited to the documented module-loading exceptions:

- `legacy-code-characterization`
- `php56-yii-dev`
- `php-pro`
- `yii1-security-audit`

Hand-maintained physical duplicates outside this allowlist are not permitted.

### 4. Installation and update semantics stay separate by platform

The supported Codex path is `scripts/hooks/install-codex-skills.sh`. It uses
symlinks by default, supports `--copy` where symlinks are unsuitable, and uses
`--update` plus version/fingerprint provenance to refresh a consumer project.
It copies `config.toml.example` without overwriting an existing
`config.toml`.

The Codex marketplace manifests and thin wrapper remain available as an
experimental compatibility surface. They must not vendor a second skill tree,
and documentation must require cache inspection before declaring the path
usable. The wrapper may be retired only after a separately approved,
end-to-end runtime verification demonstrates reliable materialization on the
supported Codex releases.

### 5. Synchronization is Claude-first and approval-gated

`multi-ai-sync` classifies mappings as `equivalent`, `adapted`, or
`skip-incompatible`. A run produces a read-only plan before tasks or mutation,
requires approval before apply, requires a dry-run before mutation, and keeps
manual review items visible. Unsupported capabilities remain in the skip
register; they are not forced into a target schema.

Gemini and Antigravity are adapter targets only. No direct Gemini agent parity
or Antigravity agent parity is promised. The `agy-fast-worker` backend is a
worker integration and is not the same concept as the Antigravity target.

### 6. Invocation authority and validation scope remain explicit

Every Distributed Entry declares its own `explicit-only` or
`implicit-eligible` Invocation Class. `/dhpk:do` may select only
`implicit-eligible` entries; explicit-only entries still require direct human
invocation. Plugin management commands and skill invocation syntax are
documented as separate surfaces.

Automatic cross-platform validation covers configured platforms with
deterministic local evidence. An absent unrequested platform is
`not-configured`; an explicitly requested but absent platform is `BLOCKED`; a
configured but broken platform is `FAIL`; and an applicable capability without
a stable equivalent remains `skip-incompatible`. `PASS` and `FAIL` retain
their existing meanings; `PARTIAL` is superseded (see below).

`multi-ai-sync validate` implements this with the concrete report vocabulary
`PASS`/`FAIL`/`NOT_CONFIGURED`/`SKIP_INCOMPATIBLE` (uppercase) as per-row and
final-gate values, plus `BLOCKED` as a third top-level gate value for an
explicitly `--targets`/`--all-targets`-requested absent platform. `PARTIAL`
survives only as a deprecated, removal-pending `legacy_gate` compatibility
field alongside the primary `gate` field — see
`skills/multi-ai-sync/references/execution-contract.md` §Validation for the
exact mapping.

### 7. Versions, metadata, and public claims are kept coherent

Claude and Codex manifests, the Codex wrapper, and the Codex marketplace entry
remain version-locked. Canonical packages own their `agents/openai.yaml`
metadata; projections inherit or verify it rather than creating divergent
metadata.

Public descriptions must not rely on hand-maintained approximate component
counts. Counts are either generated and validated from the same inventory or
omitted in favor of durable capability descriptions.

## Consequences

- Readers can distinguish supported installation from development, experiment,
  and conversion paths before choosing a command.
- Canonical edits have one ownership point, while Codex remains intentionally
  smaller and flatter than Claude.
- Experimental Codex marketplace support remains testable without being
  mistaken for a stable consumer guarantee.
- Cross-platform validation can report incompatibility without manufacturing
  false parity.
- Release documentation and metadata require a synchronized update when a
  distribution contract changes.

## Non-goals

- This decision does not change executable code, mirror membership, or runtime
  marketplace behavior.
- This decision does not add Gemini or Antigravity native plugin packaging.
- This decision does not authorize reverse synchronization into Claude.
- Implementation changes to any surface require a separate reviewed change.

## Verification boundary

The policy is documented in `CONTEXT.md`, this ADR, and the English/Traditional
Chinese operational guides. Existing manifest, Codex layout, catalog, harness,
and multi-AI self-test gates remain the implementation verification boundary;
their passing results do not upgrade an Experimental or Adapter-only surface
to Supported.
