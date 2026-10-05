# Dependency and test choices

Use this reference when a proposed module crosses an I/O or ownership boundary.
Classify the actual dependencies before choosing a substitute or adapter.

| Dependency | Evidence to collect | Test choice |
| --- | --- | --- |
| Computation or memory owned by the module | Inputs, observable outputs, and state lifetime | Exercise the public interface directly. Keep implementation details private. |
| Local I/O with an available substitute | Installed substitute, its supported behavior, and relevant differences from production | Use it for the behavior it can represent; verify differences at the real integration boundary. |
| A service maintained by the same organization | Owner, transport contract, failure behavior, and existing test facilities | Exercise domain behavior with a justified adapter; verify the transport contract separately. |
| A service maintained externally | Supported contract, failure modes, and available sandbox or captured fixtures | Inject the external boundary for deterministic tests. Record what still requires a sandbox or live observation. |

An available substitute is evidence from the checkout or test environment,
not a hypothetical library. If none is available, report the missing prerequisite
and the smallest experiment that would resolve it. Synthetic results prove
the tested boundary, not availability or correctness of a live service.

## Choosing a seam

Apply the caller-leverage, deletion, and adapter tests in the skill's primary
path. Place an internal test substitute behind the public interface when
callers do not need to choose it. Expose a dependency choice only when it is
part of the caller's real decision or a justified deployment boundary.

Keep existing tests that protect distinct behavior. Consolidate overlapping
tests only after the replacement preserves their observable contracts; module
deepening alone is not evidence that old tests can be removed.

## Decision record

For each material dependency, report its owner and boundary, the available
substitute, the behavior that can be verified, and the remaining integration
evidence. Stop short of implementation when a required dependency or boundary
decision remains unresolved.

## Source basis

This decision aid combines the existing dhpk module-boundary rules with the
dependency-classification idea examined in Matt Pocock's
[`codebase-design` reference](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/engineering/codebase-design/DEEPENING.md).
Its choices and evidence requirements are written for dhpk's existing workflow.
