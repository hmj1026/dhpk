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
