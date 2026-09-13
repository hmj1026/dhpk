# Deprecated Command Alias Contract

Legacy explicit-only aliases remain for compatibility with existing callers;
new routes use the canonical command or skill named by the alias body.

- Preserve the exact target, flags, and `$ARGUMENTS` forwarding.
- Do not add new routing through an alias or silently broaden its scope.
- Completion is the canonical target's PASS/FAIL/verdict and exit status,
  reported with the target evidence; a non-zero target result stops the alias.
