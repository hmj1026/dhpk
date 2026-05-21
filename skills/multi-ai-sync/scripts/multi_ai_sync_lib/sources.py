"""Capability evidence and source arbitration helpers."""

import json
import os

from .constants import CONFLICT_REGISTRY_CANDIDATES, SOURCE_ARBITRATION_POLICY, STATUS_ADAPT, STATUS_EQ, STATUS_SKIP
from .utils import read_text, relpath, safe_exists, uniq


def gemini_hook_surface_enabled(repo_root):
    candidates = [
        os.path.join(repo_root, ".gemini/hooks"),
        os.path.join(repo_root, ".gemini/extensions"),
    ]
    for path in candidates:
        if os.path.isdir(path):
            return True
    settings_json = os.path.join(repo_root, ".gemini/settings.json")
    if safe_exists(settings_json):
        try:
            payload = json.loads(read_text(settings_json))
            if isinstance(payload, dict) and payload.get("hooks"):
                return True
        except Exception:
            return False
    return False


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
        "gemini": [
            "https://context7.com/google-gemini/gemini-cli",
            "https://github.com/google-gemini/gemini-cli",
        ],
        "antigravity": [
            "https://context7.com/websites/antigravity_google_home",
            "https://antigravity.google",
            "https://blog.google/intl/nl-nl/product/zoeken-kijken/een-nieuw-tijdperk-van-intelligentie-met-gemini-3/",
        ],
    }
    urls = list(common.get(target, []))
    if category == "hooks" and target == "gemini":
        urls.append("https://github.com/google-gemini/gemini-cli/blob/main/packages/sdk/SDK_DESIGN.md")
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
