# Agent Distribution Context

This context defines the language for distributing skills across agent client surfaces and the model services they can invoke.

## Integration and Execution

**Host**:
An agent client integration surface through which skills are installed, discovered, or invoked, such as Claude Code, Codex CLI, Cursor, or AGY.
_Avoid_: Platform, agent platform, provider (when referring to the client surface)

**Provider**:
The real model vendor that serves a Model, such as `anthropic`, `openai`, `google`, or `xai`. A Host's own runtime is not a Provider: when Cursor runs an Anthropic model, the Provider is `anthropic`, the Host is Cursor, and `native` is the Invocation Route.
_Avoid_: Host, client, `cursor-native` (that name describes a Route, not a Provider)

**Target Agent**:
The agent client or CLI selected to receive and perform a worker task, such as Claude Code, Codex CLI, Cursor, or AGY.
_Avoid_: Provider, Model

**Model**:
A provider-scoped model identity that can be selected for agent work; the same display name under different Providers represents different Models.
_Avoid_: Global model name, model alias

**Invocation Alias**:
A short, human-facing name accepted when selecting a Target Agent or CLI and resolved to one canonical identity; `claude` means `claude-code` and `codex` means `codex-cli`.
_Avoid_: Renamed Provider, Model alias (unless it specifically aliases a Model)

**Invocation Route**:
The way a current Host reaches a Target Agent or Model: `native` when the Host supports that call directly, or `headless-cli` when it calls another Agent through a non-interactive CLI. The Route is decided by the Model Catalog, never written by the user; the public target is `agent/model[:effort]`.
_Avoid_: Universal CLI route, Provider transport, `native` as a Target Agent name

**Role Alias**:
A policy or subagent name that resolves to exactly one canonical Role (`planner`, `reasoner`, `worker`, `reviewer`) and nothing else. A Role Alias never pins a Target Agent, Provider, or Model; a caller that wants a specific backend states an explicit target instead.
_Avoid_: Provider-bound role, backend alias

**Role Default**:
The preferred Target Agent, Model, and Effort for one Role on one current Host, followed by an explicitly ordered fallback list when the preferred choice is unavailable before side effects.
_Avoid_: Global default, first catalog entry

**Host Adapter**:
A generated integration that renders the canonical distribution for one Host without owning a second skill catalog.
_Avoid_: Independent package, reverse-sync source

**Projection**:
A generated Host-facing representation of canonical skill content, with its own layout or packaging shape but the same ownership and stable capability identity.
_Avoid_: Canonical source, mirror inventory

**Shared Project Projection**:
The single project-local Projection of portable skills that Hosts bind to, owned by one Projection Receipt.
_Avoid_: Universal config root, `.agents` directory (when meaning the owned content)

**Native Projection**:
A Host-specific Projection in that Host's own configuration directory, holding the assets the Host cannot share, such as agents, rules, and commands.
_Avoid_: Legacy projection, private copy

**Projection Receipt**:
The record that is the sole lifecycle owner of the Shared Project Projection's content and its Host Bindings.
_Avoid_: Projection manifest, install log

**Host Binding**:
A receipt-owned record that one Host discovers one skill in the Shared Project Projection, either directly or through a per-skill link in its native directory. A Host Binding owns no content.
_Avoid_: Directory symlink, native copy

## Skill Distribution

**Self-Contained Skill**:
A Skill whose required code and bundled resources are contained in its canonical directory and remain usable when that directory is relocated, given its declared external tools and Host capabilities. Self-containment is independent of which Hosts the Skill supports.
_Avoid_: Dependency-free skill, packaged-only completeness, cross-Host support

**Host-Bound Skill**:
A Skill whose functionality requires capabilities specific to a declared Host. A Host-Bound Skill can also be a Self-Contained Skill.
_Avoid_: Incomplete skill, unavailable skill

## Support and Evidence

**Model Catalog**:
The declarative list of supported Host–Target-Agent–Provider–Model–Route capabilities and their selection constraints; it describes what the project supports, not what is currently available in a particular environment.
_Avoid_: Runtime inventory, availability report

**Consumer Evidence**:
An observed result from a particular Host, installation, discovery, or runtime check that indicates whether a catalog capability is usable in that environment.
_Avoid_: Catalog support, static support declaration

**Supported**:
A capability is intentionally included in the Model Catalog for a supported Host, Target Agent, Provider, Model, and Invocation Route combination.
_Avoid_: Available, installed, verified

**Available**:
A supported capability has current Consumer Evidence showing that the selected environment can use it.
_Avoid_: Supported (when no environment-specific observation exists)

## Boundaries

- A complete Model Catalog covers every supported Host–Target-Agent–Provider–Model–Route combination; it does not claim that every vendor model is supported.
- Catalog support and environment availability are separate facts and must not be inferred from one another.
- `native` versus `headless-cli` is decided by whether the current Host can call the Target Agent directly; a different vendor does not automatically mean headless CLI.
- An Invocation Alias selects a canonical Target Agent/CLI; it does not silently choose a different Model, Provider, or Route when the requested target is unavailable.
- A user may specify Effort; when omitted, the current Host/Role default applies only if the selected target supports it.
- A Host such as AGY and a Provider or worker backend such as `agy-fast-worker` are distinct concepts even when their names are related.
- A Target Agent is an agent identity (`claude-code`, `codex-cli`, `cursor`, `agy`); the Route to it is looked up, so the same target may be `native` on one Host and `headless-cli` on another.
- A Role Alias carries a Role, never a backend; Host/Role Defaults remain the only automatic selection policy.
- A Host reads portable skills through Host Bindings to the Shared Project Projection; its Native Projection holds only what cannot be shared. Removing a Host removes its bindings, not shared content another Host still binds.

## Release Evidence

**CI Runtime Baseline**:
The single Node.js version used by repository-owned CI, release automation, and local development. It does not declare a minimum Node.js version for consumers or installation surfaces.
_Avoid_: Consumer runtime requirement, Node support matrix

**Published Pending**:
A release state in which the immutable GitHub Release exists but required runtime evidence is not yet complete. Pending evidence remains visible without treating publication itself as failed.
_Avoid_: Release failure, complete release
