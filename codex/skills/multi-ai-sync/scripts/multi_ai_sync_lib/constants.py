"""Constants used by multi-ai-sync modules."""

TARGETS_DEFAULT = ["codex", "gemini", "antigravity"]

STATUS_EQ = "equivalent"
STATUS_ADAPT = "adapted"
STATUS_SKIP = "skip-incompatible"

ALL_CATEGORIES = ["skills", "commands", "agents", "config", "hooks", "multi-agents"]

CHECK_PASS = "pass"
CHECK_FAIL = "fail"
CHECK_SKIP = "skip"

SOURCE_ARBITRATION_POLICY = "context7_then_official"

CONFLICT_REGISTRY_CANDIDATES = [
    ".claude/skills/multi-ai-sync/references/source-conflicts.json",
    ".codex/skills/multi-ai-sync/references/source-conflicts.json",
    "artifacts/multi-ai-sync-source-conflicts.json",
]

