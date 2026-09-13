# Publish Codex native skills as an inventory-generated package

Status: accepted

dhpk will publish its native Codex marketplace surface from a generated
physical package at `plugins/dhpk/`, using an explicit `codex-native`
allowlist in the distribution inventory. The package is tracked as derived
publication material, while canonical skills remain the only authored source;
the default branch carries the current package and immutable release tags
retain history.

## Context

The previous native manifests depended on a symlink mirror and a
parent-relative wrapper path. A staged physical candidate could pass a clean
Codex cache test, but that candidate was not the artifact consumed by the
marketplace. The inventory also had a distinct `codex-native` surface without
native entries, while the generator selected every `promoted` entry.

## Decision

- The concrete marketplace source is `./plugins/dhpk`; release assets are
  supplementary evidence or recovery material, not the primary source.
- Native package membership is explicit through `codex-native`, initially the
  existing 15-entry Codex subset, and is not inferred from lifecycle alone.
- The package uses an internal `./skills/` path and contains physical files
  only. Generated output is validated and committed through the release PR,
  never treated as a second authored source.
- SOURCE, PACKAGE, and CONSUMER gates validate the same publication artifact.
  Missing consumer tooling is BLOCKED/UNAVAILABLE, not PASS.
- Native marketplace support remains Experimental after this change. A
  consumer PASS enables a later support-graduation review but does not itself
  change the public tier. `install-codex-skills.sh` remains Supported.

## Considered Options

- Release asset as the primary marketplace source: rejected because the
  verified marketplace contract consumes a concrete package inside a Git
  marketplace source.
- Keep the symlink mirror and improve documentation: rejected because a clean
  cache can still lose the skill targets.
- Select every `promoted` entry: rejected because it conflates lifecycle with
  the explicitly curated native subset and omits approved optional exceptions.
- Automatically graduate native support after one smoke test: rejected
  because CLI/cache behavior and supported-version scope require a separate
  public support decision.

## Consequences

The repository carries generated physical content and must validate it against
canonical sources on every relevant release. Consumers can install the exact
package that the gates inspect, while historical package states remain
recoverable from immutable release tags. Native publication remains a useful
experimental surface without weakening the supported project-local Codex sync
path.
