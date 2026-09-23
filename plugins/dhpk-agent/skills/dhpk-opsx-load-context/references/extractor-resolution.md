# Compact extractor resolution

The extractor is part of this Skill. Resolve it from the selected package's
own `scripts/` directory; never search a parent checkout, ambient plugin root,
consumer `.claude` directory, or peer Skill.
`$SKILL_DIR` denotes the physical directory containing the selected `SKILL.md`;
it is path notation, not an ambient environment variable or repository-root
lookup. Resolve it before running this snippet from an arbitrary consumer cwd.

```bash
extractor="$SKILL_DIR/scripts/extract-compact.sh"
if [ ! -x "$extractor" ]; then
  echo "CONTEXT_SOURCE=unresolved: package-local scripts/extract-compact.sh is missing" >&2
else
  "$extractor" "$COMPACT"
fi
```

The selected Skill package supplies `$SKILL_DIR` before this procedure runs, so
the executable remains package-local. If it is absent or not executable,
report the actionable `unresolved` state and continue to Tier 2 rather than
guessing a path or loading a peer copy.
