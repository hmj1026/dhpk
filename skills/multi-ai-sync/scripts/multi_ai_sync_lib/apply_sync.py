# DEPRECATED: v1 apply logic, retained for reference only.
# Active implementation: apply_sync_v2.py (imported by cli.py)
"""Apply deterministic sync actions from a generated plan (v1, deprecated)."""

import json
import errno
import os
import re
import shutil

from .constants import STATUS_ADAPT
from .utils import now_iso, read_text


def _ensure_parent(path):
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)


def _copy_file(src, dst):
    _ensure_parent(dst)
    shutil.copy2(src, dst)


def _sync_directory(src_dir, dst_dir):
    if not os.path.isdir(src_dir):
        raise IOError("source dir 不存在: %s" % src_dir)
    for root, _dirs, files in os.walk(src_dir):
        rel = os.path.relpath(root, src_dir)
        target_root = dst_dir if rel == "." else os.path.join(dst_dir, rel)
        if not os.path.isdir(target_root):
            os.makedirs(target_root)
        for name in files:
            src_path = os.path.join(root, name)
            dst_path = os.path.join(target_root, name)
            shutil.copy2(src_path, dst_path)


def _split_frontmatter(markdown):
    if not markdown.startswith("---"):
        return {}, markdown
    parts = markdown.split("---", 2)
    if len(parts) < 3:
        return {}, markdown

    frontmatter_raw = parts[1]
    body = parts[2].lstrip("\r\n")
    frontmatter = {}
    for line in frontmatter_raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$", line)
        if not match:
            continue
        key = match.group(1).strip()
        value = match.group(2).strip().strip('"').strip("'")
        frontmatter[key] = value
    return frontmatter, body


def _escape_toml_basic(value):
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _render_gemini_command_toml(source_rel_path, source_markdown):
    frontmatter, body = _split_frontmatter(source_markdown)
    description = frontmatter.get("description", "").strip()
    if not description:
        description = "Migrated from Claude command: %s" % os.path.basename(source_rel_path)

    prompt = body.strip()
    if not prompt:
        prompt = "TODO: migrate prompt from `%s`" % source_rel_path

    lines = []
    lines.append('description = "%s"' % _escape_toml_basic(description))
    lines.append("")
    if "'''" in prompt:
        prompt_escaped = prompt.replace("\\", "\\\\").replace('"""', '\\"""')
        lines.append('prompt = """')
        lines.append(prompt_escaped)
        lines.append('"""')
    else:
        lines.append("prompt = '''")
        lines.append(prompt)
        lines.append("'''")
    lines.append("")
    lines.append('[meta]')
    lines.append('source = "%s"' % _escape_toml_basic(source_rel_path))
    lines.append('synced_by = "multi-ai-sync"')
    lines.append('synced_at = "%s"' % now_iso())
    lines.append("")
    return "\n".join(lines)


def _manual_result(item, reason):
    return {
        "target": item["target"],
        "category": item["category"],
        "feature_name": item["feature_name"],
        "source_path": item.get("source_path"),
        "target_path": item.get("target_path"),
        "action": "manual",
        "reason": reason,
    }


def _apply_result(item, action, reason):
    return {
        "target": item["target"],
        "category": item["category"],
        "feature_name": item["feature_name"],
        "source_path": item.get("source_path"),
        "target_path": item.get("target_path"),
        "action": action,
        "reason": reason,
    }


def _failed_result(item, reason):
    return {
        "target": item["target"],
        "category": item["category"],
        "feature_name": item["feature_name"],
        "source_path": item.get("source_path"),
        "target_path": item.get("target_path"),
        "action": "failed",
        "reason": reason,
    }


def _apply_mapping(item, repo_root, dry_run):
    source_rel = item.get("source_path")
    target_rel = item.get("target_path")

    if not source_rel or not target_rel:
        return _manual_result(item, "缺少 source/target path，需人工處理")

    source_abs = os.path.join(repo_root, source_rel)
    target_abs = os.path.join(repo_root, target_rel)

    if not os.path.exists(source_abs):
        return _failed_result(item, "source 不存在: %s" % source_rel)

    category = item.get("category")
    target = item.get("target")

    try:
        if category == "skills":
            src_dir = os.path.dirname(source_abs)
            dst_dir = os.path.dirname(target_abs)
            if not dry_run:
                _sync_directory(src_dir, dst_dir)
            return _apply_result(item, "applied", "已同步整個 skill 目錄")

        if category == "commands" and target == "gemini":
            source_md = read_text(source_abs)
            toml_content = _render_gemini_command_toml(source_rel, source_md)
            if not dry_run:
                _ensure_parent(target_abs)
                with open(target_abs, "w") as fh:
                    fh.write(toml_content)
            return _apply_result(item, "applied", "已轉換為 Gemini command TOML")

        if category == "commands" and target == "antigravity":
            if not dry_run:
                _copy_file(source_abs, target_abs)
            return _apply_result(item, "applied", "已同步為 Antigravity workflow Markdown")

        return _manual_result(item, "此類型不做自動改寫，避免跨平台語意誤差")
    except OSError as exc:
        if exc.errno in (errno.EROFS, errno.EACCES, errno.EPERM):
            return _manual_result(item, "目標路徑不可寫，需人工處理: %s" % target_rel)
        return _failed_result(item, "套用失敗: %s" % exc)
    except Exception as exc:
        return _failed_result(item, "套用失敗: %s" % exc)


def apply_plan(plan, repo_root, dry_run=False):
    adapted = [item for item in plan.get("mappings", []) if item.get("status") == STATUS_ADAPT]
    results = []
    for item in adapted:
        results.append(_apply_mapping(item, repo_root, dry_run))

    summary = {
        "applied": len([r for r in results if r["action"] == "applied"]),
        "manual": len([r for r in results if r["action"] == "manual"]),
        "failed": len([r for r in results if r["action"] == "failed"]),
    }
    return {
        "generated_at": now_iso(),
        "dry_run": bool(dry_run),
        "total_adapted": len(adapted),
        "summary": summary,
        "results": results,
    }


def render_apply_markdown(report):
    lines = []
    lines.append("# Multi AI Sync Apply 報告")
    lines.append("")
    lines.append("產生時間（generated_at）: `%s`" % report["generated_at"])
    lines.append("dry_run: `%s`" % ("true" if report.get("dry_run") else "false"))
    lines.append("")

    summary = report.get("summary", {})
    lines.append("## Summary")
    lines.append("")
    lines.append("- total adapted: `%s`" % report.get("total_adapted", 0))
    lines.append("- applied: `%s`" % summary.get("applied", 0))
    lines.append("- manual: `%s`" % summary.get("manual", 0))
    lines.append("- failed: `%s`" % summary.get("failed", 0))
    lines.append("")

    lines.append("## Results")
    lines.append("")
    for item in report.get("results", []):
        lines.append("- [%s] [%s] %s :: `%s`" % (
            item["action"],
            item["target"],
            item["category"],
            item["feature_name"],
        ))
        lines.append("  Source: `%s`" % (item.get("source_path") or "-"))
        lines.append("  Target: `%s`" % (item.get("target_path") or "-"))
        lines.append("  Reason: %s" % item.get("reason", ""))
    return "\n".join(lines)


def load_plan(path):
    with open(path, "r") as fh:
        return json.load(fh)
