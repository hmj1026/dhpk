#!/usr/bin/env bash
#
# emit-review-gate.sh — emit the review-gate state marker.
#
# Usage:
#   emit-review-gate.sh <PENDING|READY|BLOCKED>
#
# Prints `REVIEW_GATE=<value>` on stdout. Skills pair this with the text sentinel
# they write for the behavior layer (see skills/codex-code-review/references/
# review-common.md). The marker is consumed by a review-state hook when one is
# wired; with no hook it is a harmless, greppable status line.
set -euo pipefail

state="${1:-}"
case "$state" in
  PENDING|READY|BLOCKED) ;;
  *) echo "usage: emit-review-gate.sh <PENDING|READY|BLOCKED>" >&2; exit 2 ;;
esac

echo "REVIEW_GATE=${state}"
