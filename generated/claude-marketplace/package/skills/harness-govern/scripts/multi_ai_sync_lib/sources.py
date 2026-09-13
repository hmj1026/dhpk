"""Capability evidence and source arbitration helpers."""

import glob
import json
import os

from .constants import (
    CONFLICT_REGISTRY_CANDIDATES,
    SOURCE_ARBITRATION_POLICY,
    STATUS_ADAPT,
    STATUS_EQ,
    STATUS_SKIP,
    TARGETS_DEFAULT,
)
from .utils import read_text, relpath, safe_exists, uniq


def resolve_configured_targets(repo_root):
    """Task 2.1/5.1: documented configuration markers for each target.

    A target is "configured" when its primary marker exists — mere presence,
    not full validity (an invalid-but-present marker is a `FAIL`, not an
    absence). See design.md Decision 6 / resolved Open Question for the
    exact marker set, reused from the pre-existing per-platform validators.
    """
    return {
        "codex": safe_exists(os.path.join(repo_root, ".codex/config.toml")),
        "antigravity": bool(glob.glob(os.path.join(repo_root, ".agent/rules/*.md"))),
        "agy": any(safe_exists(os.path.join(repo_root, marker)) for marker in (
            "plugins/dhpk-agy/plugin.json",
            ".gemini/config/plugins/dhpk/plugin.json",
        )),
        "cursor": (
            os.path.lexists(os.path.join(repo_root, ".cursor/.dhpk-installed.json"))
            or any(safe_exists(os.path.join(repo_root, marker)) for marker in (
                "plugins/dhpk-agent/plugin.json",
                ".cursor-plugin/plugin.json",
                ".cursor/plugins/local/dhpk-agent/plugin.json",
                ".cursor/plugins/local/dhpk-cursor/.cursor-plugin/plugin.json",
            ))
        ),
    }


def resolve_target_membership(repo_root, targets=None, all_targets=False):
    """Task 2.1/2.2: the single target-set resolver shared by discovery, plan,
    apply, smoke, and validation (design.md Decision 1 and 6).

    Returns an ordered ``{platform: {"present": bool, "requested": bool}}``
    map for the non-Claude targets that should appear in this run's report:

    - No ``targets`` and ``all_targets=False`` (default auto-discovery): every
      documented target is included but none are "requested" — an absent one
      is ``NOT_CONFIGURED``.
    - ``all_targets=True``: every documented target is included and
      "requested" — an absent one is ``BLOCKED`` (ADR 0002/0003 full audit).
    - ``targets=[...]``: only the named targets are included, and each is
      "requested" — an absent one is ``BLOCKED``.
    """
    configured = resolve_configured_targets(repo_root)
    if targets:
        included = list(dict.fromkeys(targets))
        requested = True
    else:
        included = list(TARGETS_DEFAULT)
        requested = bool(all_targets)
    return {
        platform: {"present": configured.get(platform, False), "requested": requested}
        for platform in included
    }


def split_source_urls(urls):
    context7 = []
    official = []
    for url in urls:
        if "context7.com/" in url:
            context7.append(url)
        else:
            official.append(url)
    return context7, official


def evidence_sources(target, category):
    common = {
        "claude": [
            "https://context7.com/anthropics/claude-code",
            "https://code.claude.com/docs/en/slash-commands",
        ],
        "codex": [
            "https://context7.com/openai/codex",
            "https://developers.openai.com/codex",
            "https://github.com/openai/codex",
        ],
        "antigravity": [
            "https://context7.com/websites/antigravity_google_home",
            "https://antigravity.google",
            "https://blog.google/intl/nl-nl/product/zoeken-kijken/een-nieuw-tijdperk-van-intelligentie-met-gemini-3/",
        ],
        "agy": [
            "https://www.antigravity.google/docs/cli/plugins",
            "https://github.com/hmj1026/dhpk/blob/main/docs/agy-subagent-plugin-guide.md",
        ],
        "cursor": [
            "https://cursor.com/docs/plugins",
            "https://cursor.com/docs/reference/plugins",
        ],
    }
    urls = list(common.get(target, []))
    context7_urls, official_urls = split_source_urls(urls)
    return {
        "all_urls": urls,
        "context7_urls": context7_urls,
        "official_urls": official_urls,
    }


def load_conflict_registry(repo_root):
    for rel in CONFLICT_REGISTRY_CANDIDATES:
        abs_path = os.path.join(repo_root, rel)
        if not safe_exists(abs_path):
            continue
        try:
            payload = json.loads(read_text(abs_path))
        except Exception:
            continue

        if isinstance(payload, dict):
            entries = payload.get("entries", [])
        elif isinstance(payload, list):
            entries = payload
        else:
            entries = []

        if not isinstance(entries, list):
            entries = []

        normalized = []
        for item in entries:
            if isinstance(item, dict):
                normalized.append(item)

        return {
            "source_path": relpath(abs_path, repo_root),
            "entries": normalized,
        }

    return {
        "source_path": None,
        "entries": [],
    }


def conflict_entry_match(entry, target, category, feature):
    key_map = [
        ("target", target),
        ("category", category),
        ("feature_id", feature["id"]),
        ("feature_name", feature["name"]),
    ]
    for key, value in key_map:
        if key in entry and entry.get(key) != value:
            return False
    return True


def find_conflict_entry(conflict_registry, target, category, feature):
    for entry in conflict_registry.get("entries", []):
        if conflict_entry_match(entry, target, category, feature):
            return entry
    return None


def build_source_arbitration(evidence, conflict_registry, conflict_entry):
    final_authority = "official" if evidence["official_urls"] else "context7"
    arbitration = {
        "policy": SOURCE_ARBITRATION_POLICY,
        "final_authority": final_authority,
        "context7_urls": list(evidence["context7_urls"]),
        "official_urls": list(evidence["official_urls"]),
        "conflict_detected": bool(conflict_entry),
        "conflict_registry_source": conflict_registry.get("source_path"),
    }
    if conflict_entry:
        arbitration["conflict_note"] = conflict_entry.get(
            "note",
            "偵測到衝突；以官方文件為最終依據。",
        )
    return arbitration


def apply_conflict_override(mapping, conflict_entry):
    if not conflict_entry:
        return mapping

    if conflict_entry.get("status") in (STATUS_EQ, STATUS_ADAPT, STATUS_SKIP):
        mapping["status"] = conflict_entry["status"]
    if "target_path" in conflict_entry:
        mapping["target_path"] = conflict_entry["target_path"]
    if conflict_entry.get("reason"):
        mapping["reason"] = conflict_entry["reason"]

    arbitration = mapping.get("source_arbitration", {})
    if isinstance(conflict_entry.get("context7_urls"), list):
        arbitration["context7_urls"] = conflict_entry["context7_urls"]
    if isinstance(conflict_entry.get("official_urls"), list):
        arbitration["official_urls"] = conflict_entry["official_urls"]
    arbitration["conflict_detected"] = True
    arbitration["final_authority"] = "official" if arbitration.get("official_urls") else "context7"
    arbitration["conflict_note"] = conflict_entry.get(
        "note",
        "偵測到衝突；以官方文件為最終依據。",
    )
    mapping["source_arbitration"] = arbitration
    mapping["evidence_urls"] = uniq(arbitration.get("context7_urls", []) + arbitration.get("official_urls", []))
    mapping["conflict_note"] = arbitration["conflict_note"]
    return mapping


def mapping_result(feature, target, target_path, status, reason, evidence, source_arbitration):
    payload = {
        "target": target,
        "category": feature["category"],
        "feature_id": feature["id"],
        "feature_name": feature["name"],
        "source_path": feature["source_path"],
        "target_path": target_path,
        "status": status,
        "reason": reason,
        "evidence_urls": list(evidence["all_urls"]),
        "source_arbitration": source_arbitration,
    }
    if source_arbitration.get("conflict_note"):
        payload["conflict_note"] = source_arbitration["conflict_note"]
    return payload
