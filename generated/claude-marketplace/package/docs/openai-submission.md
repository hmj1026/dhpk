# OpenAI Public Plugin submission

> **Languages**: **English** · [繁體中文](./openai-submission.zh-TW.md)

## Acceptance applicability (#848/#854)

Installation and package checks are separate from native Host workflow,
rendered discovery, context-budget research, portal submission and publication.
Ordinary documentation or package changes do not require a model session. A
named integration defect or explicit native request requires the affected Host
evidence; `NOT_RUN`, `UNAVAILABLE`, and `BLOCKED` remain truthful and never
become `PASS`. ChatGPT Work execution is not claimed by package generation.
The twelve historical follow-ups are tracked in the
[durable disposition contract](contracts/host-runtime-followup-disposition.md).

This is the submission-preparation SSOT for dhpk's skills-only OpenAI Public
Plugin candidate. The target is the shared public Plugins Directory for Codex
and ChatGPT Work. OpenAI publication is not complete: this repository has a
builder and candidate metadata, but the current candidate has not been uploaded,
approved, or published.

## Candidate and delivery status

The portable package is built from the accepted
[marketplace catalog](./contracts/marketplace-catalog.md) and uses root
`plugin.json` plus `skills/`. It contains 15 public workflow entries and 45
bundled child resources. Child resources provide conditional guidance inside
their owning skill; they are not separate public listings or selector entries.
Host-only and withdrawn skills are excluded. Optional agent-role/custom-role
distribution has separate acceptance and is outside this skills-only candidate.

The candidate metadata is maintained in
[`manifests/openai-submission.json`](../manifests/openai-submission.json). Its
version is `0.64.4`, matching the current repository plugin version. The
candidate `developerName` is `hmj1026`, as directed by the user; portal identity
verification remains `NOT_RUN`. The privacy URL is
a candidate link to this repository's `develop` branch. The policy below is a
draft and is not published or approved for submission until that public URL
resolves to reviewed content.

| Evidence | Current status |
|---|---|
| Builder implementation and local structural checks | Implemented; see [distribution surfaces](./distribution-surfaces.md#openai-submission-artifact) |
| Artifact generated and verified from the exact clean release candidate | `NOT_RUN` for this release candidate |
| Fresh Codex and ChatGPT Work workflow execution against that artifact | `NOT_RUN` |
| Final rendered discovery and runtime-budget acceptance | `NOT_RUN` until recorded against an actual installed artifact and receipt |
| Publisher identity and required policy attestations | `NOT_RUN` |
| Portal upload, platform scans, submission, approval, and public publication | `NOT_RUN` |
| Public directory availability | `NOT_PUBLISHED` |

The one-time legacy-installation cutover executor has not shipped. This guide
does not migrate, remove, or reconcile existing Codex sync/native installs or
other Host state. Continue to use the existing compatibility procedures where
they are currently required; assess cutover separately before changing them.

## Build and verify the candidate package

Run generation from a clean, committed checkout whose `HEAD` is the intended
release candidate. The output directory must be a new physical directory
outside the checkout; do not reuse a pre-existing path unless it contains the
valid artifact and receipt produced by this builder.

```bash
bin/dhpk distribution openai-submission generate \
  --manifest manifests/openai-submission.json \
  --output /absolute/path/outside/dhpk/dhpk-openai-submission \
  --json

bin/dhpk distribution openai-submission validate \
  --output /absolute/path/outside/dhpk/dhpk-openai-submission \
  --json

bin/dhpk distribution openai-submission verify \
  --output /absolute/path/outside/dhpk/dhpk-openai-submission \
  --json
```

Generation publishes `package.zip` and `provenance.json`. The receipt binds the
source commit and tree, selection, archive digest, and extracted-file
fingerprints. `validate` and `verify` check the ZIP and its receipt against the
current public selection; a successful result is local structural/package
evidence only. It does not prove consumer execution, safety scans, portal
acceptance, or publication. The receipt is an integrity record, not a signed
publisher attestation.

For a deterministic comparison, run the same commands from the same clean
commit into two different, previously nonexistent output directories and
compare the `package.zip` SHA-256 digests. Keep both outputs outside the source
tree. Do not run `generate` from a dirty checkout: provenance generation fails
closed when tracked or untracked checkout content is present.

The generator accepts the complete public catalog only. Partial `--profile`,
`--skill`, and `--standalone` selectors are unsupported. Do not add MCP servers,
apps, hooks, credentials, reviewer-only notes, or test credentials to this
skills-only artifact. Listing and asset fields are checked against the current
portable manifest contract; image file existence, square dimensions, and final
portal rendering still need release-candidate verification.

## Installation and development sources

After the public listing is approved and appears in the universal directory,
users can find **DHPK** in the Plugins Directory from a supported Codex or
ChatGPT Work surface and install it there. Use that plugin manager to remove an
installed public plugin. Start a new conversation after installation before
evaluating its skills. Public availability is shared across supported Codex
and ChatGPT surfaces; each Host still needs its own observed workflow evidence.

For Codex CLI, start `codex`, open `/plugins`, search for DHPK, and select
**Install plugin**. In ChatGPT, open the Plugins Directory, find DHPK, and add
it before starting a new Work conversation.

Repository or personal marketplaces are development/testing sources, not the
public listing and not dhpk's daily-use OpenAI route. Codex CLI manages a
configured marketplace with `codex plugin marketplace add`; within a
development marketplace, its commands are `codex plugin add` and
`codex plugin remove`. These commands do not publish a public listing. Local
marketplace availability can vary by Host and must not be presented as a
published consumer installation.

See [platform installation](./platform-installation.md#openai-skills-only-public-plugin)
for the support boundary and
[basic operations](./basic-operations.md#distribution-surface-policy) for the
current and compatibility routes.

## Release checklist

Keep these evidence states separate and update them only from a recorded run:

1. Build the complete catalog from the exact clean release commit; run
   `generate`, `validate`, and `verify` above and retain the ZIP digest and
   receipt.
2. Install that exact ZIP through the supported test route in a new Codex
   session. Record the client version,
   artifact digest, visible public skill names, and representative workflow
   results. Children must remain resources, not additional selectors.
3. Measure rendered listing/discovery and its actual Host budget from the
   installed candidate. Static caps in
   [`manifests/discovery-budgets.json`](../manifests/discovery-budgets.json)
   are planning limits, not runtime acceptance.
4. Confirm the verified developer identity and required account/policy
   attestations in the OpenAI portal.
5. Publish the reviewed privacy policy and confirm that the support and website
   URLs resolve publicly. Rebuild and reverify the candidate if any package
   metadata or assets change.
6. Upload the ZIP, complete platform scans, submit it for review, record the
   platform decision, and verify that the approved version appears in the
   public directory.

ChatGPT Work consumer verification is a separate future publication
prerequisite. Its current status is `NOT_VERIFIED` (`NOT_RUN`); it is not part
of Codex candidate acceptance. Do not claim ChatGPT Work support or acceptance
until that verification passes.

At the current checkpoint, steps 1–6 are `NOT_RUN` for the release candidate;
the privacy policy URL is not yet a published policy, and the candidate is
`NOT_PUBLISHED`. Do not mark those gates complete based on a generated ZIP,
local marketplace entry, catalog count, or package validator.

## Official references

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
  documents the portable root manifest and marketplace-source boundary.
- [Plugin quickstart](https://developers.openai.com/plugins/quickstart)
  describes the shared directory for ChatGPT and Codex and the install flow.
- [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission)
  defines submission materials and listing fields.
- [Submission errors](https://developers.openai.com/plugins/deploy/submission-errors)
  documents final metadata, image, scan, and publisher-identity checks.
