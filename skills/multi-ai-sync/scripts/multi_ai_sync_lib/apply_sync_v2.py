"""Apply deterministic sync actions from a generated plan (v2)."""

import errno
import json
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


def _render_gemini_command_toml(source_rel_path, source_markdown, sync_run_id):
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
    lines.append("[meta]")
    lines.append('source = "%s"' % _escape_toml_basic(source_rel_path))
    lines.append('synced_by = "multi-ai-sync"')
    lines.append('synced_at = "%s"' % now_iso())
    lines.append('sync_run_id = "%s"' % _escape_toml_basic(sync_run_id))
    lines.append("")
    return "\n".join(lines)


def _normalize_path(path):
    return path.replace("\\", "/")


def _to_abs(path, repo_root):
    expanded = os.path.expanduser(path)
    if os.path.isabs(expanded):
        return os.path.abspath(expanded)
    return os.path.abspath(os.path.join(repo_root, expanded))


def _to_rel_for_report(path_abs, repo_root):
    try:
        rel = os.path.relpath(path_abs, repo_root)
        if rel.startswith(".."):
            return _normalize_path(path_abs)
        return _normalize_path(rel)
    except Exception:
        return _normalize_path(path_abs)


def _nearest_existing_parent(path):
    current = path
    while True:
        if os.path.exists(current):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return current
        current = parent


def _is_path_writable(path):
    parent = _nearest_existing_parent(path)
    probe_dir = parent if os.path.isdir(parent) else os.path.dirname(parent)
    if not probe_dir:
        return False
    probe = os.path.join(probe_dir, ".multi_ai_sync_write_probe_%d" % os.getpid())
    try:
        fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        os.remove(probe)
        return True
    except OSError:
        return False


def _resolve_codex_skill_target(target_rel, repo_root, fallback_roots):
    planned_abs = os.path.join(repo_root, target_rel)
    if _is_path_writable(planned_abs):
        return planned_abs, target_rel, False, ""

    skill_name = os.path.basename(os.path.dirname(target_rel))
    for root in fallback_roots:
        root_abs = _to_abs(root, repo_root)
        candidate_abs = os.path.join(root_abs, skill_name, "SKILL.md")
        if _is_path_writable(candidate_abs):
            candidate_rel = _to_rel_for_report(candidate_abs, repo_root)
            reason = "`.codex/skills` 不可寫，改用 fallback root `%s`" % _to_rel_for_report(root_abs, repo_root)
            # Task 1.6: 若 fallback 為 legacy alias，加入 WARNING 提示
            if ".agents/skills" in root.replace("\\", "/"):
                reason = "[WARNING: legacy alias `.agents/skills` used as fallback — migrate to `.agent/skills`] " + reason
            return candidate_abs, candidate_rel, True, reason

    return planned_abs, target_rel, False, ""


def _manual_result(item, reason, target_path=None):
    return {
        "target": item["target"],
        "category": item["category"],
        "feature_name": item["feature_name"],
        "source_path": item.get("source_path"),
        "target_path": target_path if target_path is not None else item.get("target_path"),
        "action": "manual",
        "reason": reason,
        "used_fallback": False,
    }


def _apply_result(item, action, reason, target_path=None, used_fallback=False):
    return {
        "target": item["target"],
        "category": item["category"],
        "feature_name": item["feature_name"],
        "source_path": item.get("source_path"),
        "target_path": target_path if target_path is not None else item.get("target_path"),
        "action": action,
        "reason": reason,
        "used_fallback": bool(used_fallback),
    }


def _failed_result(item, reason, target_path=None):
    return {
        "target": item["target"],
        "category": item["category"],
        "feature_name": item["feature_name"],
        "source_path": item.get("source_path"),
        "target_path": target_path if target_path is not None else item.get("target_path"),
        "action": "failed",
        "reason": reason,
        "used_fallback": False,
    }


def _build_action_breakdown(results, key_name):
    breakdown = {}
    for item in results:
        key = item.get(key_name, "-")
        if key not in breakdown:
            breakdown[key] = {
                "applied": 0,
                "manual": 0,
                "failed": 0,
            }
        action = item.get("action")
        if action in breakdown[key]:
            breakdown[key][action] += 1
    return breakdown


def _apply_mapping(item, repo_root, dry_run, codex_skill_fallback_roots, sync_run_id):
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
            effective_target_abs = target_abs
            effective_target_rel = target_rel
            used_fallback = False
            fallback_reason = ""
            if target == "codex":
                effective_target_abs, effective_target_rel, used_fallback, fallback_reason = _resolve_codex_skill_target(
                    target_rel,
                    repo_root,
                    codex_skill_fallback_roots,
                )
            src_dir = os.path.dirname(source_abs)
            dst_dir = os.path.dirname(effective_target_abs)
            if not dry_run:
                _sync_directory(src_dir, dst_dir)
            reason = "已同步整個 skill 目錄"
            if used_fallback:
                reason = "%s（%s）" % (reason, fallback_reason)
            return _apply_result(item, "applied", reason, target_path=effective_target_rel, used_fallback=used_fallback)

        if category == "commands" and target == "gemini":
            source_md = read_text(source_abs)
            toml_content = _render_gemini_command_toml(source_rel, source_md, sync_run_id=sync_run_id)
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


def _checkbox_state(checked):
    return "x" if checked else " "


def update_tasks_from_apply_report(tasks_path, report):
    if not os.path.exists(tasks_path):
        return {
            "updated": False,
            "path": tasks_path,
            "reason": "找不到 tasks 檔案",
            "checked": 0,
            "unchecked": 0,
        }

    task_re = re.compile(r"^- \[( |x)\] ([0-9]+)\. \[([^\]]+)\] ([^:]+) :: `(.+)`$")

    applied_keys = set()
    for item in report.get("results", []):
        if item.get("action") == "applied":
            applied_keys.add((item.get("target"), item.get("category"), item.get("feature_name")))

    lines = read_text(tasks_path).splitlines()
    updated_lines = []
    for line in lines:
        match = task_re.match(line)
        if match:
            idx = match.group(2)
            target = match.group(3).strip()
            category = match.group(4).strip()
            feature = match.group(5).strip()
            checked = (target, category, feature) in applied_keys
            line = "- [%s] %s. [%s] %s :: `%s`" % (_checkbox_state(checked), idx, target, category, feature)
        updated_lines.append(line)

    with open(tasks_path, "w") as fh:
        fh.write("\n".join(updated_lines) + "\n")

    checked = len([line for line in updated_lines if re.match(r"^- \[x\] [0-9]+\. ", line)])
    unchecked = len([line for line in updated_lines if re.match(r"^- \[ \] [0-9]+\. ", line)])
    return {
        "updated": True,
        "path": tasks_path,
        "reason": "依 apply 結果回寫 tasks checkbox",
        "checked": checked,
        "unchecked": unchecked,
    }


def apply_plan(plan, repo_root, dry_run=False, codex_skill_fallback_roots=None, sync_run_id=""):
    adapted = [item for item in plan.get("mappings", []) if item.get("status") == STATUS_ADAPT]
    fallback_roots = codex_skill_fallback_roots or ["artifacts/codex-skills-fallback", ".agent/skills", ".agents/skills", "~/.codex/skills"]
    run_id = sync_run_id or now_iso().replace(":", "-")

    results = []
    for item in adapted:
        results.append(_apply_mapping(item, repo_root, dry_run, fallback_roots, sync_run_id=run_id))

    summary = {
        "applied": len([r for r in results if r["action"] == "applied"]),
        "manual": len([r for r in results if r["action"] == "manual"]),
        "failed": len([r for r in results if r["action"] == "failed"]),
        "fallback_applied": len([r for r in results if r.get("used_fallback")]),
    }
    return {
        "generated_at": now_iso(),
        "sync_run_id": run_id,
        "dry_run": bool(dry_run),
        "codex_skill_fallback_roots": [_to_rel_for_report(_to_abs(root, repo_root), repo_root) for root in fallback_roots],
        "total_adapted": len(adapted),
        "summary": summary,
        "breakdown_by_target": _build_action_breakdown(results, "target"),
        "breakdown_by_category": _build_action_breakdown(results, "category"),
        "results": results,
    }


def render_manual_draft_markdown(report):
    sync_run_id = report.get("sync_run_id", "")
    manual_items = [item for item in report.get("results", []) if item.get("action") == "manual"]
    filtered = [item for item in manual_items if item.get("category") in ("agents", "config", "multi-agents")]

    lines = []
    lines.append("# Manual Migration Draft (Review-Ready, Not Applied)")
    lines.append("")
    lines.append("sync_run_id: `%s`" % sync_run_id)
    lines.append("")

    if not filtered:
        lines.append("沒有需要人工審核的 `agents/config/multi-agents` 項目。")
        return "\n".join(lines)

    lines.append("## Manual Items")
    lines.append("")
    for idx, item in enumerate(filtered, 1):
        lines.append("%d. `%s / %s / %s`" % (idx, item["target"], item["category"], item["feature_name"]))
        lines.append("   Source: `%s`" % (item.get("source_path") or "-"))
        lines.append("   Target: `%s`" % (item.get("target_path") or "-"))
        lines.append("   Reason: %s" % item.get("reason", ""))
    lines.append("")

    lines.append("## Patch Draft Strategy")
    lines.append("")
    lines.append("- `agents`: 僅補 source trace 與 sync 標記，不直接覆寫既有 role 指令。")
    lines.append("- `config`: 僅補 mapping trace（來源設定檔/執行 run id），避免跨平台權限語意誤植。")
    lines.append("- `multi-agents`: 僅補來源索引，後續由人工逐條比對 orchestration 規則。")
    lines.append("")

    lines.append("## Suggested Snippets")
    lines.append("")
    lines.append("```toml")
    lines.append("[sync.claude]")
    lines.append('source = ".claude/settings.local.json"')
    lines.append('sync_run_id = "%s"' % sync_run_id)
    lines.append('sync_status = "manual-review-required"')
    lines.append("```")
    lines.append("")
    lines.append("```md")
    lines.append("## Claude Sync Trace")
    lines.append("- source: `.claude/settings.local.json`")
    lines.append("- sync_run_id: `%s`" % sync_run_id)
    lines.append("- sync_status: `manual-review-required`")
    lines.append("```")
    return "\n".join(lines)


def _load_toml_from_string(content):
    try:
        import tomllib
        return tomllib.loads(content)
    except Exception:
        try:
            import tomli
            return tomli.loads(content)
        except Exception:
            raise RuntimeError("沒有可用 TOML parser（tomllib/tomli）")


def run_self_tests():
    cases = [
        {
            "name": "basic-literal-prompt",
            "source": ".claude/commands/sample.md",
            "markdown": "---\ndescription: Sample Command\n---\nLine1\nPath: C:\\\\Temp\\\\a.txt\n",
            "expect_desc": "Sample Command",
        },
        {
            "name": "contains-triple-single-quote",
            "source": ".claude/commands/sample2.md",
            "markdown": "---\ndescription: Sample2\n---\nStart\n'''quoted'''\nEnd",
            "expect_desc": "Sample2",
        },
    ]
    results = []
    for case in cases:
        try:
            rendered = _render_gemini_command_toml(case["source"], case["markdown"], "self-test-run")
            parsed = _load_toml_from_string(rendered)
            ok = (
                parsed.get("description") == case["expect_desc"]
                and parsed.get("meta", {}).get("sync_run_id") == "self-test-run"
                and "prompt" in parsed
            )
            results.append({
                "name": case["name"],
                "status": "pass" if ok else "fail",
                "reason": "" if ok else "rendered TOML 欄位不符合預期",
            })
        except Exception as exc:
            results.append({
                "name": case["name"],
                "status": "fail",
                "reason": str(exc),
            })

    passed = len([r for r in results if r["status"] == "pass"])
    failed = len(results) - passed
    return {
        "generated_at": now_iso(),
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "results": results,
    }


def render_self_test_markdown(report):
    lines = []
    lines.append("# Multi AI Sync Self-Test")
    lines.append("")
    lines.append("產生時間（generated_at）: `%s`" % report["generated_at"])
    lines.append("- total: `%s`" % report.get("total", 0))
    lines.append("- passed: `%s`" % report.get("passed", 0))
    lines.append("- failed: `%s`" % report.get("failed", 0))
    lines.append("")
    lines.append("## Cases")
    lines.append("")
    for item in report.get("results", []):
        lines.append("- [%s] `%s` %s" % (item["status"], item["name"], item.get("reason", "")))
    return "\n".join(lines)


def render_apply_markdown(report):
    lines = []
    lines.append("# Multi AI Sync Apply 報告")
    lines.append("")
    lines.append("產生時間（generated_at）: `%s`" % report["generated_at"])
    lines.append("sync_run_id: `%s`" % report.get("sync_run_id", ""))
    lines.append("dry_run: `%s`" % ("true" if report.get("dry_run") else "false"))
    lines.append("")

    summary = report.get("summary", {})
    lines.append("## Summary")
    lines.append("")
    lines.append("- total adapted: `%s`" % report.get("total_adapted", 0))
    lines.append("- applied: `%s`" % summary.get("applied", 0))
    lines.append("- fallback applied: `%s`" % summary.get("fallback_applied", 0))
    lines.append("- manual: `%s`" % summary.get("manual", 0))
    lines.append("- failed: `%s`" % summary.get("failed", 0))
    lines.append("")

    if report.get("breakdown_by_target"):
        lines.append("## Breakdown by Target")
        lines.append("")
        lines.append("| Target | Applied | Manual | Failed |")
        lines.append("|---|---:|---:|---:|")
        for target in sorted(report["breakdown_by_target"].keys()):
            row = report["breakdown_by_target"][target]
            lines.append("| %s | %s | %s | %s |" % (target, row["applied"], row["manual"], row["failed"]))
        lines.append("")

    if report.get("breakdown_by_category"):
        lines.append("## Breakdown by Category")
        lines.append("")
        lines.append("| Category | Applied | Manual | Failed |")
        lines.append("|---|---:|---:|---:|")
        for cat in sorted(report["breakdown_by_category"].keys()):
            row = report["breakdown_by_category"][cat]
            lines.append("| %s | %s | %s | %s |" % (cat, row["applied"], row["manual"], row["failed"]))
        lines.append("")

    if report.get("codex_skill_fallback_roots"):
        lines.append("## Codex Skill Fallback Roots")
        lines.append("")
        for item in report.get("codex_skill_fallback_roots", []):
            lines.append("- `%s`" % item)
        lines.append("")

    if report.get("tasks_update"):
        task_info = report["tasks_update"]
        lines.append("## Tasks Update")
        lines.append("")
        lines.append("- updated: `%s`" % ("true" if task_info.get("updated") else "false"))
        lines.append("- path: `%s`" % task_info.get("path", ""))
        lines.append("- checked: `%s`" % task_info.get("checked", 0))
        lines.append("- unchecked: `%s`" % task_info.get("unchecked", 0))
        lines.append("- reason: %s" % task_info.get("reason", ""))
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
