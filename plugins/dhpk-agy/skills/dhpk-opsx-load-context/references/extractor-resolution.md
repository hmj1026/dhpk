# Compact extractor resolution

The extractor is shipped by the dhpk plugin. Resolve it from an explicit
plugin root; never assume a consumer project has a `.claude/scripts` copy.

```bash
extractor=""
for root in "${CLAUDE_PLUGIN_ROOT:-}" "${PLUGIN_ROOT:-}" "${DHPK_PLUGIN_ROOT:-}" "${DHPK_SOURCE_ROOT:-}"; do
  if [ -n "$root" ] && [ -x "$root/scripts/opsx-apply-resume/extract-compact.sh" ]; then
    extractor="$root/scripts/opsx-apply-resume/extract-compact.sh"
    break
  fi
done
if [ -z "$extractor" ]; then
  echo "CONTEXT_SOURCE=unresolved: set PLUGIN_ROOT (installed plugin) or DHPK_SOURCE_ROOT (source checkout)" >&2
else
  "$extractor" "$COMPACT"
fi
```

`CLAUDE_PLUGIN_ROOT` is preferred for an installed plugin. `PLUGIN_ROOT` and
`DHPK_PLUGIN_ROOT` are explicit caller overrides; `DHPK_SOURCE_ROOT` supports a
source checkout. If none resolves, report the actionable `unresolved` state
and continue to Tier 2 rather than guessing a path.
