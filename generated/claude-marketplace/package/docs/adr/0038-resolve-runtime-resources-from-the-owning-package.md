# Resolve runtime resources from the owning package

Status: accepted

## Context

An ambient `CLAUDE_PLUGIN_ROOT` can select resources from a different plugin
or another dhpk copy. Issue [#1446](https://github.com/hmj1026/dhpk/issues/1446)
confirmed this with an isolated version-advisory fixture; the origin of the
incorrect Host environment value remains unverified.

The installer has a related split today: `DHPK_PLUGIN_ROOT` selects payloads
and manifests, while `DHPK_INSTALLER_ROOT` also participates in allowed-source
validation.

## Decision

Runtime resources belong to the package containing the physical executing
script. Bash and JavaScript each provide one shared resolver implementing this
policy. A matching manifest name and version validate identity but cannot
select between physical copies.

Runtime entry symlinks resolve to the physical script's package. Unresolvable
script identity or missing required resources produce an explicit failure;
resolution never searches another checkout or cache. Callers preserve their
existing advisory or blocking failure contracts. This decision does not make
all hook failures terminate a session.

Installer source data is a separate concern. `DHPK_INSTALLER_ROOT` remains the
explicit source selector, while executable code comes from the installer's own
package. This is the desired public source contract, not a description of
current internals.

Adapt the installer's internal roles so payload selection and source
validation derive from the same validated explicit data source. An internal
`DHPK_PLUGIN_ROOT` passed to the adapter must represent that data source, not
the executable-code root or an independently inherited override. Installer
source selection no longer depends on `CLAUDE_PLUGIN_ROOT`. An invalid
explicit source stops installation without fallback. Existing installer
restrictions on symlink helpers and artifacts remain enforced. Tests use
explicit injection or isolated fixtures instead of an implicit production
environment override.

## Considered options

- Rejected: trusting an environment root that contains a dhpk library, because
  it can still select another dhpk checkout or cache snapshot.
- Rejected: comparing only manifest name and version, because that cannot
  distinguish two copies of the same release.
- Rejected: treating installer data sources as runtime code roots, because that
  would break deliberate artifact selection and blur the existing code/data
  boundary.

## Consequences

Validation must cover runtime root selection in hooks, JavaScript, installers
and delivered Skill copies. Documentation literals, generator transformations
and test fixtures receive scoped exceptions with positive and negative tests.
Checkout, marketplace and standalone harness-setup layouts must satisfy their
respective delivery contracts after relocation, including paths with spaces,
without depending on the original checkout.

Upstream Host investigation is tracked separately. Local acceptance requires
behavioral regression evidence at affected reads, validator coverage and
regenerated package consistency. Acceptance of this decision does not claim
implementation or Host-runtime verification.
