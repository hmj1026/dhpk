#!/usr/bin/env bash
# Run the Codex CLI backend for change-verdict.
set -euo pipefail

BASE_BRANCH=""
TITLE=""
CUSTOM_PROMPT=""
BACKEND="cli"
SCOPE="diff"
DEPTH="fast"

usage() {
  cat <<'EOF'
Usage:
  review.sh [--backend cli] [--scope diff|branch|doc|security|tests]
            [--depth fast|full] [--base <branch>] [--title <text>]
            [--prompt <text>]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend) BACKEND="${2:-}"; shift 2 ;;
    --scope) SCOPE="${2:-}"; shift 2 ;;
    --depth) DEPTH="${2:-}"; shift 2 ;;
    --base) BASE_BRANCH="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --prompt) CUSTOM_PROMPT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "$BACKEND" != "cli" ]]; then
  echo "review.sh: only the cli backend is implemented by this wrapper" >&2
  exit 2
fi
if [[ ! "$SCOPE" =~ ^(diff|branch|doc|security|tests)$ ]]; then
  echo "review.sh: scope must be diff, branch, doc, security, or tests" >&2
  exit 2
fi
if [[ ! "$DEPTH" =~ ^(fast|full)$ ]]; then
  echo "review.sh: depth must be fast or full" >&2
  exit 2
fi
if [[ "$SCOPE" == "branch" && -z "$BASE_BRANCH" ]]; then
  echo "review.sh: --scope branch requires --base <branch>" >&2
  exit 2
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "[ERROR] codex CLI not found. Install: npm install -g @openai/codex" >&2
  exit 127
fi
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[ERROR] Not inside a git repository." >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Pin the review to a non-empty merge-base. A moving branch name or an empty
# base makes a later re-review incomparable and can silently hide changes.
if [[ -n "$BASE_BRANCH" ]]; then
  MERGE_BASE="$(git merge-base "$BASE_BRANCH" HEAD 2>/dev/null || true)"
else
  MERGE_BASE="$(git rev-parse HEAD 2>/dev/null || true)"
fi
if [[ -z "$MERGE_BASE" ]]; then
  echo "review.sh: unable to resolve a non-empty merge base" >&2
  exit 2
fi

if [[ -z "$BASE_BRANCH" ]]; then
  CHANGES="$(git status --porcelain 2>/dev/null)"
  if [[ -z "$CHANGES" ]]; then
    echo "[INFO] No uncommitted changes to review." >&2
    exit 0
  fi
  echo "=== CODEX CLI REVIEW (Uncommitted Changes) ==="
else
  CHANGES="$(git diff --name-only "$MERGE_BASE"..HEAD 2>/dev/null)"
  if [[ -z "$CHANGES" ]]; then
    echo "[INFO] No changes compared to $BASE_BRANCH." >&2
    exit 0
  fi
  echo "=== CODEX CLI REVIEW (vs $BASE_BRANCH; merge-base $MERGE_BASE) ==="
fi

echo ""
echo "Changed files:"
if [[ -z "$BASE_BRANCH" ]]; then
  git status --short
else
  git diff --name-only "$MERGE_BASE"..HEAD | head -20
fi
echo ""

CMD=(codex review)
if [[ -z "$BASE_BRANCH" ]]; then
  CMD+=(--uncommitted)
else
  CMD+=(--base "$MERGE_BASE")
fi
if [[ -n "$TITLE" ]]; then
  CMD+=(--title "$TITLE")
fi
CMD+=(-c 'sandbox_permissions=["disk-full-read-access"]')

# Scope and depth are review workflow metadata.  Keep them in the prompt rather
# than interpolating them into a shell command so hostile values remain literal.
WORKFLOW_PROMPT="$(printf 'Review scope: %s\nReview depth: %s\nPinned merge base: %s\nReview both Standards and Spec axes.' "$SCOPE" "$DEPTH" "$MERGE_BASE")"
if [[ -n "$CUSTOM_PROMPT" ]]; then
  CUSTOM_PROMPT="$(printf '%s\n%s' "$WORKFLOW_PROMPT" "$CUSTOM_PROMPT")"
else
  CUSTOM_PROMPT="$WORKFLOW_PROMPT"
fi

echo "[INFO] Running: ${CMD[*]}"
echo ""

set +e
printf '%s\n' "$CUSTOM_PROMPT" | "${CMD[@]}" -
CODE=$?
set -e

echo ""
if [[ $CODE -ne 0 ]]; then
  echo "[ERROR] codex review failed (exit=$CODE)." >&2
  exit "$CODE"
fi
echo "=== END ==="
