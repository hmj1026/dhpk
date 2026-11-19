# Two Published Packages, everything else built on demand

Status: accepted (2026-11-18); amends the package-topology parts of
[ADR-0024](0024-current-plugin-distribution-and-unique-discovery.md). Its
ownership, unique-discovery, and manual-authorization decisions stay in force.

dhpk is published to two directories: Anthropic's Claude plugin directory and
OpenAI's universal plugin directory. Each enforces rules the repository root
cannot meet: Claude holds packages over 512 files or with a non-image file over
256 KiB for review and blocks one without a README; OpenAI refuses any package
that carries lifecycle hooks. Before this decision the repository committed one
generated tree per Host (Claude marketplace, Codex native, `dhpk-agent`,
Cursor, AGY), each with its own skill selection, and hand-listed the version
files, so `manifests/openai-submission.json` drifted to 0.64.4 while the
repository was at 0.78.0.

We decided:

- **Exactly two Published Packages are committed**: the Directory Plugin
  (Claude) and the Public Plugin (OpenAI, skills-only, hook-free). The Codex
  native package uses the Public Plugin's tree and skill set; the root
  `.codex-plugin` is retired so no Codex plugin root sits beside Claude hooks.
- **Cursor, AGY, and `dhpk-agent` packages are no longer committed.** They are
  built on demand by a local command and attached to each GitHub Release.
  Retirement of those surfaces is a later decision, after one release of usage
  evidence.
- **Stack modules move to a second plugin, `dhpk-stacks`**, which requires the
  core plugin and owns the `modules` setting, so the core Directory Plugin stays
  under the review thresholds.
- **The Codex installer ships as readable source** split into modules under
  256 KiB, not as one generated bundle, because plugin-only users (no checkout,
  package not on npm) still need Codex project setup.
- **One version source**: `package.json`. Every Host manifest is generated, and
  release parity checks the files the generators declare, not a hand list.
- `generated/` is renamed `dist/` only in the same change that stops committing
  the on-demand trees, so consumers see one path move.
  Done in #1510: the Agent, Cursor and AGY packages build into the ignored
  `dist/on-demand/` with `bin/dhpk distribution build <surface>`, and the release
  workflow attaches their archives to the GitHub Release. The Claude marketplace
  `source` paths are `./dist/claude-marketplace/package` and
  `./dist/claude-marketplace/stacks-package`; Claude Code resolves a relative
  `source` from the marketplace root and only forbids `..`, so the directory name
  carries no restriction.

## Considered Options

- Commit every Host tree (status quo): rejected; five trees with three skill
  sets and three versions are the source of the drift above.
- Publish trees only on a `dist` ref or as release assets: deferred; whether the
  Claude marketplace can read a non-default ref is unverified.
- Remove the installer from the plugin: rejected; it breaks plugin-only Codex
  setup.
