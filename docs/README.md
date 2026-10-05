# Documentation

Keep reusable product, installation, operations, architecture decisions, and
contributor guidance versioned in `docs/`. Store accepted behavioral
specifications in `openspec/specs/<capability>/spec.md`.

| Location | Contents | Git policy |
| --- | --- | --- |
| `docs/*.md` | User guides and reusable contributor documentation | Versioned |
| `docs/agent-guidance/` | Agent authoring and workflow contracts | Versioned |
| `docs/agents/` | Domain and issue-tracker guidance | Versioned |
| `docs/proposals/` | Explicitly requested versioned proposals for PR review; adoption and implementation remain separate | Versioned |
| `docs/adr/` | Accepted architecture decisions and their rationale | Versioned |
| `docs/contracts/` | Reusable artifact and review contracts | Versioned |
| `docs/design/` | Proposals, design exploration, implementation plans, historical designs | Local, ignored |
| `docs/evidence/` | Run receipts, benchmarks, investigations, audits, progress records | Local, ignored |
| `docs/evidence/knowledge/` | Consolidated investigation and knowledge records | Local, ignored |
| `openspec/specs/` | Accepted requirements with executable scenarios | Versioned |
| `openspec/changes/` | Pending proposals, designs, delta specs, tasks, archives | Local, ignored |
| `tests/fixtures/` | Fixed inputs and independent expected results required by tests | Versioned |
| `manifests/` | Machine-readable runtime and distribution contracts | Versioned |

The durable Host-runtime follow-up dispositions are recorded in
[`contracts/host-runtime-followup-disposition.md`](contracts/host-runtime-followup-disposition.md).
Ignored `openspec/changes/` plans are provenance and working state; they are not
the only source of accepted policy in a fresh checkout.

The [proposal review index](proposals/README.md) contains the explicitly requested versioned review records for #817 telemetry and cutover planning. This is a review-publication exception to local design storage: keep general drafts and run evidence ignored. A proposal PR merge does not adopt its requirements or authorize implementation. Record adoption separately before synchronizing accepted behavior into `openspec/specs/`.

Classify by content and use, rather than filename: a current operating
procedure belongs in a reusable guide; the output from one execution belongs
in `docs/evidence/`. Promote accepted decisions to an ADR or contract and
accepted behavior to an OpenSpec requirement. Keep dated observations and
unchecked plans in the local record.

Versioned guides, validators, tests, and release packages must work when local
design and evidence directories are absent. A historical evidence path may
remain as provenance, but it must be labeled local and unavailable in a fresh
checkout. Required fixed inputs belong in a versioned fixture or manifest.

For OpenSpec and superpowers authoring, follow
[the authoring contract](agent-guidance/openspec-authoring.md). External
superpowers tools follow the repository storage policy; their implementation
and installation are owned by the external tool.

## Guides by type

- Installation and environment: [platform installation](platform-installation.md),
  [Docker setup](docker-setup.md), [permissions](recommended-permissions.md),
  [configuration](configuration.md), and [AGY plugins](agy-subagent-plugin-guide.md).
- Operations and commands: [basic operations](basic-operations.md),
  [command cheat sheet](skill-command-cheat-sheet.md),
  [Codex skill usage](codex-skill-usage.md), [portable commands](portable-command-skills.md),
  and [harness workflow](harness-workflow.md).
- Development and verification: [testing governance](testing-governance.md),
  [worker-context benchmark](worker-context-benchmark.md),
  [hook extensions](hook-extension.md), and [subagent prompts](subagent-prompt-template.md).
- Distribution and migration: [distribution surfaces](distribution-surfaces.md),
  [release artifacts](release-artifact-contract.md),
  [skill platform migration](skill-platform-migration.md), and
  [Codex transport ownership](codex-mcp-capability-parity.md).
- Agent authoring: [guidance index](agent-guidance/README.md).
- Contracts: [artifacts](contracts/artifact-contract.md),
  [marketplace classifications](contracts/marketplace-catalog.md), and
  [marketplace licensing](contracts/marketplace-licensing.md).
- Decisions: accepted rationale lives in `adr/`; domain and issue management
  guidance lives in `agents/`.

Paired `*.zh-TW.md` guides are translations of the same document type. Keep
their contracts synchronized with the corresponding English guide.
