#!/usr/bin/env bash
# pre-agent-warmstart.sh — PreToolUse (Task|Agent) hook: inject parent-session
# context into subagent prompts via the standard hookSpecificOutput
# additionalContext JSON. Opt-in (userConfig.agent_warmstart_enabled, default
# false) — injecting context into every subagent costs tokens and other
# consumers must ask for it explicitly.
#
# Role-filtered sections (default-off; each packet is capped separately):
#   reviewer  — active sentinel/scope only
#   worker/TDD — supplied handoff prompt plus bounded OpenSpec/project context
#   explorer  — routing reminder only
#   monitor   — process identity only
#
# One-shot override: DHPK_AGENT_WARMSTART=1/0.
# Exit code: always 0 (advisory; any failure falls back to an empty JSON
# object so the Claude Code parser never breaks).

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
ROOT="$(dhpk_root)"
. "$(dirname "$0")/_lib/load-project-config.sh" 2>/dev/null || true
. "$(dirname "$0")/_lib/payload.sh"

# Opt-in gate (env override > userConfig > default off).
_enabled="$(dhpk_config_bool agent_warmstart_enabled false DHPK_AGENT_WARMSTART)"
if [ "$_enabled" != "true" ]; then
    printf '{}'
    exit 0
fi

# minimal profile keeps subagent prompts lean.
PROFILE="$(dhpk_config_profile)"
if [ "$PROFILE" = "minimal" ]; then
    printf '{}'
    exit 0
fi

PAYLOAD="$(dhpk_read_payload)"
SUBAGENT_TYPE="$(extract_tool_input subagent_type "$PAYLOAD")"
HANDOFF_PACKET="$(extract_tool_input prompt "$PAYLOAD")"

command -v python3 >/dev/null 2>&1 || { printf '{}'; exit 0; }

out="$(
    CLAUDE_PROJECT_DIR="$ROOT" \
    SENTINEL_NAMES="${SENTINEL_NAMES[*]}" \
    SENTINEL_LABELS="${SENTINEL_LABELS[*]}" \
    SENTINEL_AGENTS="${SENTINEL_AGENTS[*]}" \
    SUBAGENT_TYPE="$SUBAGENT_TYPE" \
    HANDOFF_PACKET="$HANDOFF_PACKET" \
    python3 <<'PY' 2>/dev/null || printf '{}'
import json, os
from pathlib import Path

ROOT = Path(os.environ["CLAUDE_PROJECT_DIR"]).resolve()
sentinels = os.environ.get("SENTINEL_NAMES", "").split()
labels = os.environ.get("SENTINEL_LABELS", "").split()
agents = [entry.split(":")[-1].strip().lower() for entry in os.environ.get("SENTINEL_AGENTS", "").split()]
role = os.environ.get("SUBAGENT_TYPE", "").split(":")[-1].strip().lower()
handoff = os.environ.get("HANDOFF_PACKET", "").strip()
reviewer_roles = {
    "code-reviewer", "database-reviewer", "security-reviewer",
    "frontend-reviewer", "doc-reviewer", "polyfill-reviewer",
    "migration-reviewer",
}
reviewer_roles.update(agent for agent in agents if agent)
worker_roles = {"worker", "fast-worker", "tdd-guide", "e2e-runner"}

def read_text_safe(p, max_chars=400):
    try:
        t = p.read_text(encoding="utf-8", errors="replace")
        return t if len(t) <= max_chars else t[: max_chars - 3] + "..."
    except OSError:
        return ""

lines = []

# === Section 1: Active sentinels + chain order ===
sess_dir = ROOT / ".claude" / "artifacts" / "sessions"
active = []
if sess_dir.is_dir():
    for s in sentinels:
        if (sess_dir / s).is_file():
            active.append(s)
if role in reviewer_roles:
    matching = [s for s, agent in zip(sentinels, agents) if agent == role and s in active]
    if matching:
        lines.append("Active review sentinel: " + ", ".join(matching))
    else:
        lines.append("Reviewer role: " + role + "; no matching active sentinel")
elif active:
    lines.append("Active review sentinels: " + ", ".join(active))

# === Role-specific early exits ===
if role == "monitor":
    lines.append("Agent role: monitor; preserve process identity and report state only")
elif role == "explorer":
    lines.append(
        "Tool routing: prefer semantic code tools (cx / gitnexus) over raw Read "
        "(see ${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md)"
    )

# === Section 2: OpenSpec active change (worker/TDD and generic roles only) ===
opsx_changes = ROOT / "openspec" / "changes"
if role not in reviewer_roles and role not in {"monitor", "explorer"} and opsx_changes.is_dir():
    # Filter to real dirs before sorting so a broken symlink can't OSError the
    # sort key and take the whole hook down.
    candidates = []
    for entry in opsx_changes.iterdir():
        if entry.name.startswith(".") or entry.name == "archive":
            continue
        try:
            if entry.is_dir():
                # Stamp the mtime now (inside the guard) so the later sort can't
                # OSError on a dir that became inaccessible after this check.
                candidates.append((entry.stat().st_mtime, entry))
        except OSError:
            continue
    candidates.sort(key=lambda pair: pair[0], reverse=True)
    candidates = [entry for _mtime, entry in candidates]
    if candidates:
        active_change = candidates[0]
        lines.append(f"OpenSpec active change: {active_change.relative_to(ROOT)}")
        tasks_md = active_change / "tasks.md"
        if tasks_md.is_file():
            preview = read_text_safe(tasks_md, max_chars=300)
            todo = []
            for ln in preview.splitlines():
                ln_s = ln.strip()
                if ln_s.startswith("- [") and len(todo) < 3:
                    todo.append(ln_s)
            if todo:
                lines.append("Tasks (first 3): " + " | ".join(todo))

# === Section 3: Supplied handoff/project context (worker/TDD and generic roles) ===
if role in worker_roles and handoff:
    lines.append("Handoff packet: " + handoff[:1000])

proj_ctx = ROOT / ".claude" / "warmstart-context.md"
if role not in reviewer_roles and role not in {"monitor", "explorer"} and proj_ctx.is_file():
    body = read_text_safe(proj_ctx, max_chars=400 if role in worker_roles else 800).strip()
    if body:
        lines.append(body)

# === Section 4: Tool-routing reminder for implementation roles ===
if role in worker_roles or not role:
    lines.append(
        "Tool routing: prefer semantic code tools (cx / gitnexus) over raw Read "
        "(see ${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md)"
    )

body = "\n".join(lines)
budgets = {
    "reviewer": 700,
    "worker": 1400,
    "explorer": 500,
    "monitor": 300,
}
budget = budgets["reviewer"] if role in reviewer_roles else budgets.get(role, 1200)
if len(body) > budget:
    body = body[: budget - 3] + "..."

ctx_block = (
    "<parent-session-context>\n"
    f"[warmstart] {ROOT.name} — parent session state for subagent:\n"
    + body
    + "\n</parent-session-context>"
)

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": ctx_block,
    }
}))
PY
)"

if [ -z "$out" ]; then
    printf '{}'
else
    printf '%s' "$out"
fi

exit 0
