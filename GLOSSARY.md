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

**CLI Role Agent**:
A role-named agent bound to one Target Agent, such as `codex-worker` or `agy-worker`. Selecting it is an explicit target choice.
_Avoid_: Role Alias, provider-bound role

**Bounded Consult**:
A planner consult that checks a brief's stated facts against only the sources the brief names, spawns no discovery children, and reports missing facts as a blocker instead of exploring.
_Avoid_: Lightweight consult, Facts-only consult, quick plan

**Discovery Consult**:
A planner consult that may explore beyond the brief's named sources within its read and discovery-child budget.
_Avoid_: Full consult, default consult

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

**Package Receipt**:
The source and ownership record shipped inside a generated Host package: which sources produced it and which files it owns. AGY uses the installed copy of it as its install-time ownership record.
_Avoid_: Provenance file, Projection Receipt (that one belongs to the Shared Project Projection)

**Projection Journal**:
The single record of an in-progress Projection install, update, uninstall, or rollback. Recovery reads only it to decide whether to finish or undo the change. It owns no content; the Projection Receipt does.
_Avoid_: Transaction log, install journal, second journal

**Host Binding**:
A receipt-owned record that one Host discovers one skill in the Shared Project Projection, either directly or through a per-skill link in its native directory. A Host Binding owns no content.
_Avoid_: Directory symlink, native copy

**Released Entry**:
A former receipt entry whose ownership the receipt gave up because ownership could no longer be proven; its files stay in place and no receipt manages them any more.
_Avoid_: Orphan, retired skill, deleted entry

## Skill Distribution

**Public Plugin**:
A versioned skills-only dhpk package intended for public distribution through OpenAI's universal plugin directory to users of Codex and ChatGPT Work.
_Avoid_: Local marketplace, project sync, installed skill directory

**Development Marketplace**:
A local or repository plugin catalog used to test dhpk before public publication.
_Avoid_: Public Plugin, public release channel

**Skill Identity**:
The stable identity of one dhpk capability, retained when its public name or distribution location changes.
_Avoid_: Public Skill Name, directory name, installation path

**Public Skill Name**:
The user-facing discovery and invocation name of a Skill Identity on a Host.
_Avoid_: Stable ID, capability ID, source path

**Public Workflow**:
A discoverable dhpk skill entry for a recognizable user task, with a defined input, outcome, and authority boundary.
_Avoid_: Task skill, 任務技能, internal runtime, Specialist Reference, every knowledge file

**Method**:
A reusable way of working, such as test-first development or failure diagnosis, that a user can invoke directly or a Public Workflow can apply; it does not own the task's outcome.
_Avoid_: Public Workflow, Specialist Reference, 按需方法, procedure owner

**Project Convention**:
A consumer project's own branching, test-command, delivery, and versioning practice, which a Public Workflow follows but never supplies.
_Avoid_: Portable policy, dhpk workflow, global rule, 消費專案指引

**Specialist Reference**:
Task-selected dhpk guidance for a language, framework, version, or other specialist concern, loaded by a Public Workflow without an independent discovery entry.
_Avoid_: Public Workflow, optional discoverable skill, second capability owner

**Discovery Source**:
An active installation source through which a Host discovers a dhpk skill in a particular consumer context.
_Avoid_: Canonical source, generated artifact, physical copy count

**Duplicate Discovery**:
Multiple visible entries for the same Skill Identity within one Host and consumer context, including entries under old and new public names.
_Avoid_: Generated copies, shared content across different Hosts, same-name collision between distinct capabilities

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

## Credential Guard

**Protected Path**:
A path that the effective credential read policy, the default patterns plus the consumer's custom patterns minus template files, forbids an agent command to read.
_Avoid_: Credential file, secret file, sensitive path

**Exclusion Proof**:
Evidence, stated in the command itself, that a recursive read excludes every effective credential pattern.
_Avoid_: Safe search, exclusion list

**Absence Proof**:
Evidence, gathered within fixed bounds at check time, that none of the files a read would open is a Protected Path, whether from a scan of the read's search roots or from the repository's own listing of the files involved. It is a point-in-time observation, not a guarantee for the moment the command runs.
_Avoid_: Safe directory, clean directory, credential-free directory

**Reader**:
A command or subcommand the credential guard knows can open file contents, such as `cat`, `sed`, `grep`, `rg`, or `git show`. Each Reader's arguments are understood only through that Reader's own option grammar.
_Avoid_: Read command, file tool

**Read Plan**:
What a Reader invocation would open: its targets, auxiliary inputs, whether it recurses and follows links, and the exclusions it states. It describes the invocation and carries no judgment about whether the read is allowed.
_Avoid_: Parsed args, classification

**Remote Wrapper**:
A command, such as `ssh`, that runs another command where the local working directory and filesystem do not apply. It is not a Reader; the command it carries is judged without local knowledge.
_Avoid_: Remote reader

**Credential Verdict**:
The credential guard's single decision about one agent command: allowed, or blocked for one named reason with the recovery advice for that reason. A guard that cannot inspect the command reaches a blocked verdict, never an allowed one.
_Avoid_: Block reason, guard result

## Git Gate

**Git Gate**:
The pre-execution check that stops an agent command from skipping commit verification or committing to a protected branch.
_Avoid_: git hook, commit guard

**Git Verdict**:
The Git Gate's single decision about one agent command: allowed, or blocked for one named reason with recovery advice. A command that carries a git token next to a construct the gate cannot resolve reaches a blocked verdict, never an allowed one.
_Avoid_: gate result

**Text Guard Scope**:
What a pre-execution guard can judge: only what the command text itself states. Content produced or written at run time, such as a script written then executed or an interpreter's code string, lies outside it.
_Avoid_: guard coverage, threat model
