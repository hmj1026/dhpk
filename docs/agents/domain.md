# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

dhpk is a single-context repository:

- **`CONTEXT.md`** at the repo root — the glossary of domain terms.
- **`docs/adr/`** — read the ADRs that touch the area you're about to work in.

When a term or decision is still unresolved, the `/domain-modeling` skill records it in these files as it is settled.

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `CONTEXT.md`. If the concept you need isn't in the glossary yet, reconsider the terminology or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding.
