# Swift Performance Traps

Applies only to Swift code on a path that matters to the workload. Apply the shared [prompt defense](../_common/prompt-defense.md); report a missing required resource as a capability gap. Concurrency correctness (races, isolation, cancellation) belongs to the code reviewer, not this sheet.

## Ground rule

A performance finding needs a measurement or a defensible cost model under a representative release-configuration workload: realistic data sizes, device class, and optimization settings. There is no universal threshold. Do not cite a fixed number of items, milliseconds, or bytes as a limit. Debug-build timings and micro-benchmarks on toy inputs are weak evidence.

## Trap format

Trigger => evidence/action. Bounds say when it does not apply.

### 1. Allocation churn

- Trigger: per-iteration object or closure creation, boxing through existential types, or copies of large value types inside a hot loop or per-frame path.
- Evidence/action: obtain an allocation or time profile from the actual workload and name the dominant allocation site. Propose a change that keeps semantics, then re-measure.
- Bounds: allocations on cold paths, one-time setup, and small bounded loops are not findings.

### 2. Collection cost

- Trigger: repeated linear search, repeated sorting, repeated concatenation to build a result, or accidental copy-on-write copies of a collection that is mutated while shared.
- Evidence/action: state the collection size at realistic scale and the number of repetitions, then show the measured or estimated total. Choose a structure matching the access pattern.
- Bounds: small collections with a known upper bound do not need a faster structure. Reserving capacity matters only when growth shows up in a profile.

### 3. String work

- Trigger: repeated string building, character-by-character indexing, repeated formatting, or regular-expression compilation inside a loop.
- Evidence/action: profile the path and show the string operation's share. Hoist or cache only what the profile implicates.
- Bounds: user-facing text built once per screen is not a hot path.

### 4. Render and layout

- Trigger: view bodies or layout passes that do heavy computation, I/O, or sorting, or state changes that invalidate far more of the view tree than needed.
- Evidence/action: use the platform's rendering and view-update profiling to show how often and how long the work runs, then move computation out of the render path.
- Bounds: trivial bodies and rarely updated screens are not findings.

### 5. Blocking and redundant I/O

- Trigger: synchronous disk, network, or database calls on a latency-sensitive context, repeated reads of the same resource, or unbatched small writes.
- Evidence/action: show the call's frequency and measured latency under the real workload. Suggest batching, caching, or moving work off the latency-sensitive context only if the data supports it.
- Bounds: startup or background work with no latency budget, and small local reads of bundled files, are acceptable.

## Reporting

Each finding states: workload assumed, measurement or model, observed cost, proposed change, and how to verify. If no measurement is available, label the finding as unmeasured and lower its confidence rather than inventing a number.

## Reference

Reference: [The Swift Programming Language](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/)
