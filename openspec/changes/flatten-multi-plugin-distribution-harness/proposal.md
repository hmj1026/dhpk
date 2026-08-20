## Why

Supporting each plugin surface currently requires parallel package adapters, generators, validators, tracked projections, documentation checks, and overlapping tests. The resulting shallow interfaces make a small content change expensive and make it easy to confuse static package proof with consumer-runtime evidence.

Gemini CLI is retired and must no longer be a supported dhpk target. Antigravity CLI (`agy`) remains an independently supported experimental target and must not be removed or described as Gemini CLI compatibility.

## What Changes

- **BREAKING** Replace the per-platform generator and validator command family with one distribution command surface: `dhpk distribution <surface> <generate|validate|verify>`.
- **BREAKING** Make the inventory-driven distribution Module the only owner of selection, staged materialization, provenance, rollback, and closed evidence vocabulary; make platform packages thin layout/probe Adapters.
- **BREAKING** Remove Gemini CLI conversion, installation, documentation, configuration, and test support. Retain AGY native package and `agy` fast-worker behavior as separate Antigravity CLI support.
- Collapse duplicated projection and checked-in PASS tests into a core contract, one unique adapter contract per surface, CLI wire contracts, and one repository integration gate.
- Update the bilingual installation/support documentation and release evidence to distinguish structural validation from real consumer proof.

## Capabilities

### New Capabilities

- `flat-distribution-interface`: A single inventory-driven distribution Interface that produces and verifies every retained surface through declarative Adapters.
- `gemini-cli-retirement`: Complete removal of dhpk-owned Gemini CLI support without removing the independent AGY native plugin or fast-worker backend.

### Modified Capabilities

- `distribution-projection-contract`: Distribution behavior, generation and verification ownership move to the shared Module Interface.
- `distribution-surface-governance`: Surface ownership and support tiers change to retain AGY while removing Gemini CLI.
- `agy-cli-subagent-plugin`: AGY packaging and evidence are described as Antigravity-native rather than Gemini-compatible.
- `platform-installation-documentation`: Installation SSOT and evidence terminology reflect the retained surfaces and breaking command migration.
- `script-test-coverage`: Test coverage policy moves duplicate platform assertions to their single contract owner.

## Impact

Affected areas include `manifests/distribution-inventory.json`, distribution/package/install scripts, the CI workflow and Node test harness, generated plugin projections, installation documentation, release gates, and OpenSpec capability specifications. Consumers using retired generator/validator commands or Gemini CLI conversion must migrate to the new distribution command or stop using the retired target.
