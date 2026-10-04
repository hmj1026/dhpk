scope: release-acceptance
note: Carry selected-scope consumer acceptance through aggregation and preserve legacy exit behavior.

## Release acceptance

The consumer-gate child maps acceptance `PASS` to exit 0 and `FAIL` or
`BLOCKED` to exit 1. The outer schema-v2 release result exits 0 only for
aggregate `COMPLETE` and exits 1 for every current non-completion outcome;
legacy results without acceptance retain their existing exit mapping,
including exit 2 for `PUBLISHED_PENDING` and `BLOCKED`. The harness carries
acceptance through selected-scope aggregation and keeps installation checks
separate from raw runtime observations. AGY acceptance validates either a
concrete project binding or an isolated canonical package installation; native
runtime remains `NOT_RUN` and unsupported native requirements remain
`BLOCKED`. Release workflows validate current JSON and process exits and
summarize selected acceptance separately from observations. Readiness does not
publish or deploy.
