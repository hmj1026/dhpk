# Marketplace licensing contract

## Classification state

The marketplace catalog records 78 entries as `first-party` on a provisional
classification basis. The six `dhpk-gitnexus-*` entries are `excluded` because
GitNexus owns and distributes those capabilities. They remain excluded from
dhpk Host packages and are available only through the optional external
GitNexus tool.

`first-party` is a catalog classification, not a rights approval. The root
`LICENSE` covers dhpk-authored work only; it does not establish rights to
upstream text, code, or other third-party material.

## Rights review gate

Rights review acceptance is `NOT_RUN`. No catalog label or source-level review
counts as rights approval for a generated or published package. Before any
entry receives rights acceptance, review the actual selected package and its
installed copy:

- record the selected Host/profile and exact package file list, including
  required transitive resources;
- identify the source revision and precise source span for each third-party
  item, then record its applicable license and required notices;
- confirm that the generated package and installed copy retain every required
  notice; and
- resolve unclear rights with evidence or replace the material through an
  independently reviewed rewrite.

Until those checks are complete, retain `first-party` as provisional catalog
metadata and keep rights acceptance at `NOT_RUN`.
