"""Feature collection, mapping, and plan/task rendering."""

import glob
import os

from .constants import ALL_CATEGORIES, SOURCE_ARBITRATION_POLICY, STATUS_ADAPT, STATUS_EQ, STATUS_SKIP
from .sources import (
    apply_conflict_override,
    build_source_arbitration,
    evidence_sources,
    find_conflict_entry,
    gemini_hook_surface_enabled,
    load_conflict_registry,
    mapping_result,
)
from .utils import now_iso, parse_frontmatter_keys, relpath, safe_exists


def collect_claude_features(repo_root):
    features = []

    for skill_path in sorted(glob.glob(os.path.join(repo_root, ".claude/skills/*/SKILL.md"))):
        name = os.path.basename(os.path.dirname(skill_path))
        features.append({
            "category": "skills",
            "id": "skills/%s" % name,
            "name": name,
            "source_path": relpath(skill_path, repo_root),
        })

    for cmd_path in sorted(glob.glob(os.path.join(repo_root, ".claude/commands/**/*.md"), recursive=True)):
        rel = relpath(cmd_path, os.path.join(repo_root, ".claude/commands"))
        features.append({
            "category": "commands",
            "id": "commands/%s" % rel,
            "name": rel,
            "source_path": relpath(cmd_path, repo_root),
        })

    for agent_path in sorted(glob.glob(os.path.join(repo_root, ".claude/agents/*.md"))):
        role = os.path.splitext(os.path.basename(agent_path))[0]
        features.append({
            "category": "agents",
            "id": "agents/%s" % role,
            "name": role,
            "source_path": relpath(agent_path, repo_root),
        })

    cfg = os.path.join(repo_root, ".claude/settings.local.json")
    if safe_exists(cfg):
        features.append({
            "category": "config",
            "id": "config/settings.local.json",
            "name": "settings.local.json",
            "source_path": relpath(cfg, repo_root),
        })

    hook_files = sorted(glob.glob(os.path.join(repo_root, ".claude/hooks/**/*"), recursive=True))
    hook_files = [p for p in hook_files if os.path.isfile(p)]
    for hook_path in hook_files:
        rel = relpath(hook_path, os.path.join(repo_root, ".claude/hooks"))
        features.append({
            "category": "hooks",
            "id": "hooks/%s" % rel,
            "name": rel,
            "source_path": relpath(hook_path, repo_root),
        })

    agents_dir = os.path.join(repo_root, ".claude/agents")
    if os.path.isdir(agents_dir) and glob.glob(os.path.join(agents_dir, "*.md")):
        features.append({
            "category": "multi-agents",
            "id": "multi-agents/agent-definitions",
            "name": "agent-definitions",
            "source_path": relpath(agents_dir, repo_root),
        })

    rules_dir = os.path.join(repo_root, ".claude/rules")
    if os.path.isdir(rules_dir):
        features.append({
            "category": "multi-agents",
            "id": "multi-agents/orchestration-rules",
            "name": "orchestration-rules",
            "source_path": relpath(rules_dir, repo_root),
        })

    return features


def category_supported(target, category, repo_root):
    support = {
        "codex": set(["skills", "agents", "config", "multi-agents"]),
        "gemini": set(["skills", "commands"]),
        "antigravity": set(["skills", "commands", "config", "multi-agents"]),
    }
    if target == "gemini" and category == "hooks":
        return gemini_hook_surface_enabled(repo_root)
    return category in support.get(target, set())


def map_target_path(feature, target):
    cat = feature["category"]
    name = feature["name"]

    if cat == "skills":
        if target == "codex":
            return ".codex/skills/%s/SKILL.md" % name
        if target == "gemini":
            return ".gemini/skills/%s/SKILL.md" % name
        if target == "antigravity":
            return ".agent/skills/%s/SKILL.md" % name

    if cat == "commands":
        if name.startswith("opsx/"):
            cmd = os.path.splitext(os.path.basename(name))[0]
            if target == "gemini":
                return ".gemini/commands/opsx/%s.toml" % cmd
            if target == "antigravity":
                return ".agent/workflows/opsx-%s.md" % cmd
        else:
            cmd = os.path.splitext(os.path.basename(name))[0]
            if target == "gemini":
                return ".gemini/commands/%s.toml" % cmd
            if target == "antigravity":
                return ".agent/workflows/%s.md" % cmd

    if cat == "agents":
        role = name
        if target == "codex":
            return ".codex/agents/%s.toml" % role

    if cat == "config":
        if target == "codex":
            return ".codex/config.toml"
        if target == "antigravity":
            return ".agent/rules/project.md"

    if cat == "hooks":
        if target == "gemini":
            return ".gemini/hooks/%s" % name

    if cat == "multi-agents":
        if target == "codex":
            return ".codex/config.toml"
        if target == "antigravity":
            return ".agent/workflows/review.md"

    return None


def compare_skill_equivalence(source_path, target_path, repo_root):
    src = os.path.join(repo_root, source_path)
    tgt = os.path.join(repo_root, target_path)
    if not safe_exists(tgt):
        return False, "目標 skill file 不存在"
    src_keys = set(parse_frontmatter_keys(src))
    tgt_keys = set(parse_frontmatter_keys(tgt))
    required = set(["name", "description"])
    if not required.issubset(tgt_keys):
        return False, "目標 skill frontmatter 缺少 name/description"
    if src_keys == tgt_keys:
        return True, "skill frontmatter 結構一致"
    return False, "skill 已存在，但 frontmatter 結構不同"


def evaluate_mapping(feature, target, repo_root, conflict_registry):
    cat = feature["category"]
    target_path = map_target_path(feature, target)
    evidence = evidence_sources(target, cat)
    conflict_entry = find_conflict_entry(conflict_registry, target, cat, feature)
    source_arbitration = build_source_arbitration(evidence, conflict_registry, conflict_entry)

    if not category_supported(target, cat, repo_root):
        reason = "target 平台對此 category 尚無穩定支援"
        if target == "gemini" and cat == "hooks":
            reason = "repository 尚未配置 Gemini hook parity（請新增 .gemini/hooks、.gemini/extensions，或在 .gemini/settings.json 設定 hooks）"
        mapping = mapping_result(feature, target, None, STATUS_SKIP, reason, evidence, source_arbitration)
        return apply_conflict_override(mapping, conflict_entry)

    if not target_path:
        mapping = mapping_result(
            feature,
            target,
            None,
            STATUS_SKIP,
            "此 feature 尚無 deterministic path mapping 規則",
            evidence,
            source_arbitration,
        )
        return apply_conflict_override(mapping, conflict_entry)

    target_abs = os.path.join(repo_root, target_path)

    if cat == "skills":
        eq, reason = compare_skill_equivalence(feature["source_path"], target_path, repo_root)
        status = STATUS_EQ if eq else STATUS_ADAPT
        mapping = mapping_result(feature, target, target_path, status, reason, evidence, source_arbitration)
        return apply_conflict_override(mapping, conflict_entry)

    if cat == "commands":
        if safe_exists(target_abs):
            mapping = mapping_result(
                feature,
                target,
                target_path,
                STATUS_ADAPT,
                "command/workflow 已存在，但需要平台格式對齊",
                evidence,
                source_arbitration,
            )
            return apply_conflict_override(mapping, conflict_entry)
        mapping = mapping_result(
            feature,
            target,
            target_path,
            STATUS_ADAPT,
            "target 平台缺少對應的 mapped command/workflow",
            evidence,
            source_arbitration,
        )
        return apply_conflict_override(mapping, conflict_entry)

    if cat == "agents":
        if safe_exists(target_abs):
            mapping = mapping_result(
                feature,
                target,
                target_path,
                STATUS_ADAPT,
                "agent role 已存在，但需驗證 schema/behavior",
                evidence,
                source_arbitration,
            )
            return apply_conflict_override(mapping, conflict_entry)
        mapping = mapping_result(
            feature,
            target,
            target_path,
            STATUS_ADAPT,
            "target 平台缺少對應 agent role",
            evidence,
            source_arbitration,
        )
        return apply_conflict_override(mapping, conflict_entry)

    if cat in ("config", "hooks", "multi-agents"):
        exists = safe_exists(target_abs)
        reason = "target mapping 已存在，需做平台化 migration" if exists else "缺少 mapped target artifact"
        mapping = mapping_result(feature, target, target_path, STATUS_ADAPT, reason, evidence, source_arbitration)
        return apply_conflict_override(mapping, conflict_entry)

    mapping = mapping_result(feature, target, target_path, STATUS_SKIP, "不支援的 category", evidence, source_arbitration)
    return apply_conflict_override(mapping, conflict_entry)


def build_plan(repo_root, targets):
    source_features = collect_claude_features(repo_root)
    conflict_registry = load_conflict_registry(repo_root)
    mappings = []
    for feature in source_features:
        for target in targets:
            mappings.append(evaluate_mapping(feature, target, repo_root, conflict_registry))

    coverage = dict((category, 0) for category in ALL_CATEGORIES)
    for item in source_features:
        coverage[item["category"]] = coverage.get(item["category"], 0) + 1

    target_summary = {}
    for target in targets:
        target_summary[target] = {
            STATUS_EQ: 0,
            STATUS_ADAPT: 0,
            STATUS_SKIP: 0,
        }
    for item in mappings:
        target_summary[item["target"]][item["status"]] += 1

    return {
        "generated_at": now_iso(),
        "source": "claude",
        "targets": targets,
        "source_arbitration_policy": SOURCE_ARBITRATION_POLICY,
        "conflict_registry_source": conflict_registry.get("source_path"),
        "conflict_entries_loaded": len(conflict_registry.get("entries", [])),
        "coverage": coverage,
        "source_feature_count": len(source_features),
        "source_features": source_features,
        "mappings": mappings,
        "target_summary": target_summary,
    }


def render_plan_markdown(plan):
    lines = []
    lines.append("# Multi AI Sync 對齊計畫（Claude First）")
    lines.append("")
    lines.append("產生時間（generated_at）: `%s`" % plan["generated_at"])
    lines.append("")

    lines.append("## Coverage 摘要")
    lines.append("")
    lines.append("| Category | Claude 數量 |")
    lines.append("|---|---:|")
    for category in ALL_CATEGORIES:
        lines.append("| %s | %d |" % (category, plan["coverage"][category]))
    lines.append("")

    lines.append("## Source Arbitration")
    lines.append("")
    lines.append("- Policy: `%s`" % plan.get("source_arbitration_policy", SOURCE_ARBITRATION_POLICY))
    lines.append("- Conflict registry: `%s`" % (plan.get("conflict_registry_source") or "(none)"))
    lines.append("- 已載入 conflict entries: `%s`" % plan.get("conflict_entries_loaded", 0))
    lines.append("")

    lines.append("## Target 摘要")
    lines.append("")
    lines.append("| Target | equivalent | adapted | skip-incompatible |")
    lines.append("|---|---:|---:|---:|")
    for target in plan["targets"]:
        summary = plan["target_summary"][target]
        lines.append("| %s | %d | %d | %d |" % (target, summary[STATUS_EQ], summary[STATUS_ADAPT], summary[STATUS_SKIP]))
    lines.append("")

    adapted = [item for item in plan["mappings"] if item["status"] == STATUS_ADAPT]
    lines.append("## Migration 候選項（需審核）")
    lines.append("")
    if not adapted:
        lines.append("沒有 adapted 項目。")
    else:
        lines.append("| Target | Category | Feature | Source | Target Path | Reason |")
        lines.append("|---|---|---|---|---|---|")
        for item in adapted:
            reason = item["reason"]
            if item.get("conflict_note"):
                reason = "%s（conflict: %s）" % (reason, item["conflict_note"])
            lines.append("| %s | %s | %s | `%s` | `%s` | %s |" % (
                item["target"], item["category"], item["feature_name"], item["source_path"], item["target_path"] or "-", reason.replace("|", "\\|")
            ))
    lines.append("")

    skipped = [item for item in plan["mappings"] if item["status"] == STATUS_SKIP]
    lines.append("## Skip Register")
    lines.append("")
    if not skipped:
        lines.append("沒有 skip 項目。")
    else:
        lines.append("| Target | Category | Feature | Reason | Evidence |")
        lines.append("|---|---|---|---|---|")
        for item in skipped:
            reason = item["reason"]
            if item.get("conflict_note"):
                reason = "%s（conflict: %s）" % (reason, item["conflict_note"])
            evidence = "<br>".join(item.get("evidence_urls", []))
            lines.append("| %s | %s | %s | %s | %s |" % (
                item["target"], item["category"], item["feature_name"], reason.replace("|", "\\|"), evidence
            ))
    lines.append("")

    lines.append("## Decision Contract")
    lines.append("")
    lines.append("- 所有 `adapted` 項目都必須先審核，再執行 mutation。")
    lines.append("- 所有 `skip-incompatible` 項目都必須保留 evidence URLs。")
    lines.append("- 完成前必須執行 `validate` gate。")

    return "\n".join(lines)


def generate_tasks(plan, change_name):
    adapted = [item for item in plan.get("mappings", []) if item.get("status") == STATUS_ADAPT]
    skipped = [item for item in plan.get("mappings", []) if item.get("status") == STATUS_SKIP]

    lines = []
    lines.append("## 1. Metadata")
    lines.append("")
    lines.append("- Change: `%s`" % change_name)
    lines.append("- Source of Truth: `claude`")
    lines.append("- 產生時間（generated_at）: `%s`" % now_iso())
    lines.append("")

    lines.append("## 2. Tasks")
    lines.append("")
    if not adapted:
        lines.append("- [x] 沒有 adapted 項目，不需要 migration。")
    else:
        idx = 1
        for item in adapted:
            lines.append("- [ ] %d. [%s] %s :: `%s`" % (idx, item["target"], item["category"], item["feature_name"]))
            lines.append("  Source: `%s`" % item["source_path"])
            lines.append("  Target: `%s`" % (item["target_path"] or "(需要 mapping)"))
            lines.append("  Reason: %s" % item["reason"])
            if item.get("conflict_note"):
                lines.append("  Conflict: %s" % item["conflict_note"])
            if item.get("evidence_urls"):
                lines.append("  Evidence: %s" % ", ".join(item["evidence_urls"]))
            idx += 1
    lines.append("")

    lines.append("## 3. Skip Register")
    lines.append("")
    if not skipped:
        lines.append("沒有 skip 項目。")
    else:
        for item in skipped:
            lines.append("- `%s` / `%s` / `%s`: %s" % (item["target"], item["category"], item["feature_name"], item["reason"]))
            if item.get("conflict_note"):
                lines.append("  Conflict: %s" % item["conflict_note"])
    lines.append("")

    lines.append("## 4. Validation Gate")
    lines.append("")
    lines.append("- [ ] 執行 `python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py validate --format markdown`")
    lines.append("- [ ] 確認每個平台結果為 PASS，或已明確核准 PARTIAL")

    return "\n".join(lines)
