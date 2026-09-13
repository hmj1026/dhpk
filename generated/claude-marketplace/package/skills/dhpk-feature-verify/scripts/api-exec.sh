#!/usr/bin/env bash
set -u

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: api-exec.sh <GET|POST> <allowlisted-url> [json-payload]" >&2
  exit 2
fi

method=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
url=$2
payload=${3-}
if [[ $method != GET && $method != POST ]]; then
  echo "api-exec: method must be GET or allowlisted POST" >&2
  exit 2
fi

request_id="feature-verify-$(date +%s)-$$"
args=(-sS -X "$method" -H "X-Request-ID: $request_id" -H 'Content-Type: application/json')
if [[ $method == POST ]]; then
  args+=(--data "$payload")
fi

if response=$(curl "${args[@]}" -w $'\n__DHPK_META__ %{http_code} %{time_total}' "$url"); then
  :
else
  rc=$?
  echo "api-exec: curl transport failed (exit $rc)" >&2
  exit "$rc"
fi
meta=${response##*$'\n'__DHPK_META__ }
body=${response%$'\n'__DHPK_META__ *}
http_code=${meta%% *}
latency=${meta#* }

printf 'request_id=%s\nhttp_code=%s\nlatency_seconds=%s\nbody=%s\n' \
  "$request_id" "$http_code" "$latency" "$body"
