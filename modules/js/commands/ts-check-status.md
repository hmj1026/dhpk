---
description: Report the `// @ts-check` / `// @ts-nocheck` / unmarked distribution for the configured frontend root. Measures progressive `// @ts-check` rollout.
---

# /ts-check-status

Renders the strict-opt-in / transitional / unmarked split for JS/TS leaves
under the configured frontend root. Use it to measure progress on the
per-leaf `// @ts-check` rollout (see `js-static-check-strategy` skill for
the playbook).

Path scanned: `${CLAUDE_PLUGIN_OPTION_JS_CHECK_PATH:-js/}` — override the
userConfig if your project's leaf root lives elsewhere (e.g. `src/core/`).

```bash
ROOT="$(git rev-parse --show-toplevel)"
SCAN="${CLAUDE_PLUGIN_OPTION_JS_CHECK_PATH:-js/}"
cd "$ROOT"

if [ ! -d "$SCAN" ]; then
    echo "[ts-check-status] scan path '$SCAN' does not exist under repo root."
    echo "    Override via the js_check_path userConfig key, e.g. set it to 'src/'."
    exit 0
fi

echo "=== Strict @ts-check enabled (line-anchored — comment-internal tokens excluded) ==="
find "$SCAN" -maxdepth 1 -name '*.js' \
    -exec grep -lE '^[[:space:]]*//[[:space:]]*@ts-check[[:space:]]*$' {} \; | sort

echo
echo "=== @ts-nocheck transitional (per-leaf cleanup tracking) ==="
find "$SCAN" -maxdepth 1 -name '*.js' \
    -exec grep -lE '^[[:space:]]*//[[:space:]]*@ts-nocheck' {} \; | sort

echo
echo "=== Unmarked (exit gate target: this section must be empty) ==="
find "$SCAN" -maxdepth 1 -name '*.js' \
    -exec grep -LE '^[[:space:]]*//[[:space:]]*@ts-(no)?check' {} \; | sort

echo
echo "=== Summary ==="
total=$(find "$SCAN" -maxdepth 1 -name '*.js' | wc -l)
strict=$(find "$SCAN" -maxdepth 1 -name '*.js' -exec grep -lE '^[[:space:]]*//[[:space:]]*@ts-check[[:space:]]*$' {} \; | wc -l)
nocheck=$(find "$SCAN" -maxdepth 1 -name '*.js' -exec grep -lE '^[[:space:]]*//[[:space:]]*@ts-nocheck' {} \; | wc -l)
unmarked=$((total - strict - nocheck))
printf "total=%d  strict=%d  nocheck=%d  unmarked=%d\n" "$total" "$strict" "$nocheck" "$unmarked"
```

Then summarise:

- If `unmarked > 0`: list the unmarked files and request they enter the
  per-leaf cleanup queue.
- If `nocheck > 0`: cross-reference each file with the
  `js-static-check-strategy` skill's "leaf classification" template
  (typedef-widening-fixable vs permanent-exclude).
- If `nocheck == 0` and `unmarked == 0`: the exit gate is met — flag that
  `tsconfig.json`'s `checkJs` can flip to `true`.
