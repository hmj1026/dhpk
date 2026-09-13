"""Constants used by the Harness Govern sync modules."""

TARGETS_DEFAULT = ["codex", "antigravity", "agy", "cursor"]

STATUS_EQ = "equivalent"
STATUS_ADAPT = "adapted"
STATUS_SKIP = "skip-incompatible"

ALL_CATEGORIES = ["skills", "commands", "agents", "config", "hooks", "multi-agents"]

CHECK_PASS = "pass"
CHECK_FAIL = "fail"
CHECK_SKIP = "skip"

SOURCE_ARBITRATION_POLICY = "context7_then_official"

CONFLICT_REGISTRY_CANDIDATES = [
    ".claude/skills/harness-govern/references/source-conflicts.json",
    ".codex/skills/harness-govern/references/source-conflicts.json",
    "artifacts/harness-govern-sync-source-conflicts.json",
]

# --- Configured-platform validation status vocabulary (design.md Decisions 2 and 6) ---
# Distinct from CHECK_PASS/CHECK_FAIL/CHECK_SKIP above, which remain the
# lowercase vocabulary for the pre-existing, unrelated `run_policy_checks`
# checks (path.canonical, profile.php_pro, parity.agents.*).
ROW_PASS = "PASS"
ROW_FAIL = "FAIL"
ROW_NOT_CONFIGURED = "NOT_CONFIGURED"
ROW_SKIP_INCOMPATIBLE = "SKIP_INCOMPATIBLE"
ROW_BLOCKED = "BLOCKED"
ROW_UNAVAILABLE = "UNAVAILABLE"
ROW_NOT_RUN = "NOT_RUN"

GATE_PASS = "PASS"
GATE_FAIL = "FAIL"
GATE_BLOCKED = "BLOCKED"
