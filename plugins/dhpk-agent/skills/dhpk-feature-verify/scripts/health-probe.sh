#!/usr/bin/env bash
set -u

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: health-probe.sh <health-url>" >&2
  exit 2
fi

url=$1
for attempt in 1 2 3; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 2 "$url" 2>/dev/null) || code=000
  if [[ $code =~ ^[23][0-9][0-9]$ ]]; then
    printf 'reachable=true attempt=%s http_code=%s\n' "$attempt" "$code"
    exit 0
  fi
done

printf 'reachable=false attempts=3 http_code=%s\n' "$code"
exit 1
