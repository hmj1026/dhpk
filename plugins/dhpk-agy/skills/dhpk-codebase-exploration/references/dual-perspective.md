# Dual perspective mode

Use this reference only for `--dual`. The primary model and isolated subagent
must explore independently; do not feed one perspective's file list,
hypothesis, or conclusion into the other's prompt.

## Sequence

1. The primary model locates the entry point and traces the requested behavior.
2. Dispatch a fresh general-purpose subagent with only the original question,
   repository path, requested depth, and read-only policy. Ask it to explore on
   its own.
3. Compare evidence, not confidence. Mark agreement, disagreement, and gaps.
4. Produce one integrated conclusion with the source of each material finding.

## Clean independent prompt

```text
# Independent code exploration
Question: <user question>
Project path: <repository root>
Depth: <brief|normal|deep>

Explore the project independently. Identify related files, trace the relevant
flow, and explain evidence, edge cases, and unresolved links. Do not assume a
prior analysis or restrict the search to a suggested directory.
```

The invocation remains read-only and must not pass implementation instructions
or mutate the repository. A caller that names `--second-opinion=codex-exec`
may add a one-shot CLI perspective; preserve its evidence as a separate source.
