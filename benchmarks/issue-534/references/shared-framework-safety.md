# On-demand reference: shared framework safety

Shared framework, vendor, dependency, and externally mounted source are never
owned test surfaces. A task that asks to patch one of those paths temporarily
and restore it later is still unsafe: restoration cannot prove that concurrent
processes or untracked state were unaffected. Return `BLOCKED` with reason code
`SHARED_SOURCE_PROHIBITED` and propose a test-local probe, subclass, spy, fake,
or reflection helper at the consuming project's public seam.
