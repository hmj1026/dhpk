"""Apply deterministic sync actions from a generated plan (v2)."""

import errno
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile

from .agent_sync import SYNC_MANIFEST_PATH, build_agent_sync_bundle, build_agent_sync_manifest
from .constants import STATUS_ADAPT
from .utils import now_iso, read_text


PLAN_FIELDS = frozenset([
    "conflict_entries_loaded", "conflict_registry_source", "coverage",
    "generated_at", "mappings", "source", "source_arbitration_policy",
    "source_feature_count", "source_features", "target_summary", "targets",
])
MAPPING_FIELDS = frozenset([
    "category", "evidence_urls", "feature_id", "feature_name", "reason",
    "source_arbitration", "source_path", "status", "target", "target_path",
])
SAFE_TARGET_PREFIXES = {
    "codex": (".codex", "artifacts/codex-skills-fallback", ".agent", ".agents"),
    "antigravity": (".agent",),
    "cursor": (".cursor",),
    "agy": (),
}
SAFE_SOURCE_PREFIXES = (".claude",)
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")


def _validate_plan(plan):
    if not isinstance(plan, dict) or set(plan) - PLAN_FIELDS:
        raise ValueError("unsafe plan schema: unknown top-level fields")
    mappings = plan.get("mappings")
    if not isinstance(mappings, list):
        raise ValueError("unsafe plan schema: mappings must be an array")
    for index, item in enumerate(mappings):
        if not isinstance(item, dict) or set(item) - MAPPING_FIELDS:
            raise ValueError("unsafe plan schema: mappings[%d] has unknown fields" % index)
        for field in ("status", "target", "category", "feature_name", "source_path"):
            if not isinstance(item.get(field), str) or not item.get(field):
                raise ValueError("unsafe plan schema: mappings[%d].%s is required" % (index, field))
        if (not SAFE_NAME.fullmatch(item["feature_name"])
                or ".." in item["feature_name"].replace("\\", "/").split("/")):
            raise ValueError("unsafe plan schema: mappings[%d].feature_name is invalid" % index)
        if item["target"] not in SAFE_TARGET_PREFIXES:
            raise ValueError("unsafe plan schema: mappings[%d].target is unsupported" % index)
        target_path = item.get("target_path")
        if item["status"] == STATUS_ADAPT and (not isinstance(target_path, str) or not target_path):
            raise ValueError("unsafe plan schema: mappings[%d].target_path is required for adapted work" % index)
        if target_path is not None and not isinstance(target_path, str):
            raise ValueError("unsafe plan schema: mappings[%d].target_path must be a string or null" % index)
    return plan


def plan_sha256(path):
    _plan, digest = load_plan_with_digest(path)
    return digest


def load_plan_with_digest(path):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("unsafe plan: expected a regular file")
        with os.fdopen(fd, "rb", closefd=False) as fh:
            payload = fh.read()
    finally:
        os.close(fd)
    digest = hashlib.sha256(payload).hexdigest()
    return _validate_plan(json.loads(payload.decode("utf-8"))), digest


def _safe_repo_path(path, repo_root, allowed_prefixes, must_exist=False):
    if not isinstance(path, str) or not path or "\x00" in path or os.path.isabs(path):
        raise ValueError("unsafe path: expected a repository-relative path")
    normalized = _normalize_path(os.path.normpath(path))
    parts = normalized.split("/")
    if normalized in (".", "..") or ".." in parts:
        raise ValueError("unsafe path: traversal is not allowed")
    if not any(normalized == prefix or normalized.startswith(prefix + "/") for prefix in allowed_prefixes):
        raise ValueError("unsafe path: destination is outside the target allowlist")

    root_real = os.path.realpath(repo_root)
    candidate = os.path.abspath(os.path.join(root_real, normalized))
    if os.path.commonpath([root_real, candidate]) != root_real:
        raise ValueError("unsafe path: destination escapes the repository")

    current = root_real
    for part in parts:
        current = os.path.join(current, part)
        if os.path.lexists(current) and os.path.islink(current):
            raise ValueError("unsafe path: symlinked path component is not allowed")
    if must_exist:
        if not os.path.isfile(candidate) or os.path.islink(candidate):
            raise ValueError("unsafe path: source must be an existing regular file")
        if os.path.commonpath([root_real, os.path.realpath(candidate)]) != root_real:
            raise ValueError("unsafe path: source escapes the repository")
    return candidate


def safe_repository_path(path, repo_root, allowed_prefixes, must_exist=False):
    return _safe_repo_path(path, repo_root, tuple(allowed_prefixes), must_exist=must_exist)


def atomic_write_text(path, content):
    _write_text_file(path, content)


def _ensure_parent(path):
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)


def _copy_file(src, dst):
    _ensure_parent(dst)
    fd, temporary = tempfile.mkstemp(prefix=".multi-ai-sync-", dir=os.path.dirname(dst))
    os.close(fd)
    try:
        shutil.copy2(src, temporary)
        os.replace(temporary, dst)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def _write_text_file(path, content):
    _ensure_parent(path)
    fd, temporary = tempfile.mkstemp(prefix=".multi-ai-sync-", dir=os.path.dirname(path), text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def _sync_directory(src_dir, dst_dir, repo_root, allowed_prefixes):
    if not os.path.isdir(src_dir):
        raise IOError("source dir 不存在: %s" % src_dir)
    for root, dirs, files in os.walk(src_dir):
        if os.path.islink(root) or any(os.path.islink(os.path.join(root, name)) for name in dirs):
            raise IOError("source directory symlink is not allowed: %s" % root)
        rel = os.path.relpath(root, src_dir)
        target_root = dst_dir if rel == "." else os.path.join(dst_dir, rel)
        target_root_rel = _to_rel_for_report(target_root, repo_root)
        _safe_repo_path(target_root_rel, repo_root, allowed_prefixes)
        if not os.path.isdir(target_root):
            os.makedirs(target_root)
        _safe_repo_path(target_root_rel, repo_root, allowed_prefixes)
        for name in files:
            src_path = os.path.join(root, name)
            dst_path = os.path.join(target_root, name)
            if os.path.islink(src_path):
                raise IOError("source symlink is not allowed: %s" % src_path)
            _safe_repo_path(_to_rel_for_report(dst_path, repo_root), repo_root, allowed_prefixes)
            _copy_file(src_path, dst_path)


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
    planned_abs = _safe_repo_path(target_rel, repo_root, SAFE_TARGET_PREFIXES["codex"])
    if _is_path_writable(planned_abs):
        return planned_abs, target_rel, False, ""

    skill_name = os.path.basename(os.path.dirname(target_rel))
    for root in fallback_roots:
        root_abs = _safe_repo_path(root, repo_root, SAFE_TARGET_PREFIXES["codex"])
        candidate_abs = os.path.join(root_abs, skill_name, "SKILL.md")
        _safe_repo_path(_to_rel_for_report(candidate_abs, repo_root), repo_root, SAFE_TARGET_PREFIXES["codex"])
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

    try:
        source_abs = _safe_repo_path(source_rel, repo_root, SAFE_SOURCE_PREFIXES, must_exist=True)
        target_abs = _safe_repo_path(target_rel, repo_root, SAFE_TARGET_PREFIXES.get(item.get("target"), ()))
    except ValueError as exc:
        return _failed_result(item, str(exc))

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
                _sync_directory(src_dir, dst_dir, repo_root, SAFE_TARGET_PREFIXES[target])
            reason = "已同步整個 skill 目錄"
            if used_fallback:
                reason = "%s（%s）" % (reason, fallback_reason)
            return _apply_result(item, "applied", reason, target_path=effective_target_rel, used_fallback=used_fallback)

        if category == "commands" and target == "antigravity":
            if not dry_run:
                _copy_file(source_abs, target_abs)
            return _apply_result(item, "applied", "已同步為 Antigravity workflow Markdown")

        if category == "agents" and target == "codex":
            bundle = build_agent_sync_bundle(repo_root, item["feature_name"], sync_run_id)
            generated_files = [bundle["mirror_md"]] + [ref["target"] for ref in bundle["mirrored_ref_items"]]
            mirror_abs = _safe_repo_path(bundle["mirror_md"], repo_root, SAFE_TARGET_PREFIXES["codex"])
            validated_refs = [
                (
                    _safe_repo_path(ref["source"], repo_root, SAFE_SOURCE_PREFIXES, must_exist=True),
                    _safe_repo_path(ref["target"], repo_root, SAFE_TARGET_PREFIXES["codex"]),
                )
                for ref in bundle["mirrored_ref_items"]
            ]
            if not dry_run:
                _write_text_file(mirror_abs, bundle["mirror_content"])
                for source_path, target_path in validated_refs:
                    _copy_file(source_path, target_path)
            result = _manual_result(item, "已生成 Claude mirror/references 與 reviewer-ready TOML 草稿；target role 仍需人工覆核")
            result["generated_files"] = generated_files
            result["draft_toml_content"] = bundle["draft_toml_content"]
            result["draft_target_path"] = bundle["target_toml"]
            result["manifest_entry"] = bundle["manifest_entry"]
            result["coverage_keywords"] = bundle["coverage_keywords"]
            result["nonportable_sources"] = bundle["nonportable_sources"]
            return result

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

    _write_text_file(tasks_path, "\n".join(updated_lines) + "\n")

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
    _validate_plan(plan)
    adapted = [item for item in plan.get("mappings", []) if item.get("status") == STATUS_ADAPT]
    fallback_roots = codex_skill_fallback_roots or ["artifacts/codex-skills-fallback", ".agent/skills", ".agents/skills"]
    run_id = sync_run_id or now_iso().replace(":", "-")

    results = []
    for item in adapted:
        results.append(_apply_mapping(item, repo_root, dry_run, fallback_roots, sync_run_id=run_id))

    agent_bundles = []
    for item in results:
        if item.get("category") == "agents" and item.get("target") == "codex" and item.get("manifest_entry"):
            agent_bundles.append({"manifest_entry": item["manifest_entry"]})
    if agent_bundles:
        manifest = build_agent_sync_manifest(repo_root, run_id, agent_bundles)
        manifest_path = _safe_repo_path(SYNC_MANIFEST_PATH, repo_root, SAFE_TARGET_PREFIXES["codex"])
        if not dry_run:
            _write_text_file(manifest_path, json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        for item in results:
            if item.get("category") == "agents" and item.get("target") == "codex" and item.get("manifest_entry"):
                item["manifest_path"] = SYNC_MANIFEST_PATH
                item.setdefault("generated_files", []).append(SYNC_MANIFEST_PATH)

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
        if item.get("generated_files"):
            lines.append("   Generated:")
            for path in item.get("generated_files", []):
                lines.append("   - `%s`" % path)
        if item.get("coverage_keywords"):
            lines.append("   Coverage: %s" % ", ".join(item.get("coverage_keywords", [])))
        if item.get("nonportable_sources"):
            lines.append("   Nonportable: %s" % ", ".join(item.get("nonportable_sources", [])))
        if item.get("draft_toml_content"):
            lines.append("")
            lines.append("```toml")
            lines.append(item["draft_toml_content"].rstrip())
            lines.append("```")
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


def run_self_tests(repo_root):
    from .validation import check_codex_agent_role_fields

    results = []

    agent_cases = [
        {
            "name": "agent-bundle-tdd-guide",
            "role": "tdd-guide-<your-project>",
        },
        {
            "name": "agent-bundle-architect-parseable",
            "role": "architect-<your-project>",
            "assert_parseable": True,
            "assert_role_fields": True,
        },
        {
            "name": "agent-manifest-build",
            "role": "code-reviewer-<your-project>",
        },
        {
            "name": "agent-bundle-refactor-cleaner-parseable",
            "role": "refactor-cleaner-<your-project>",
            "assert_parseable": True,
        },
    ]
    # Agent conversion tests are converter fixtures, not consumer-repository
    # discovery tests. Build the four minimal Claude source agents in a
    # short-lived directory so `self-test` passes in a clean repo and never
    # writes to the caller's working tree. Codex-native role differences remain
    # covered by the production manifest/validation path.
    with tempfile.TemporaryDirectory(prefix="harness-govern-sync-self-test-") as fixture_root:
        agents_root = os.path.join(fixture_root, ".claude", "agents")
        codex_agents_root = os.path.join(fixture_root, ".codex", "agents")
        os.makedirs(agents_root)
        os.makedirs(codex_agents_root)
        for case in agent_cases:
            role = case["role"]
            source_path = os.path.join(agents_root, "%s.md" % role)
            with open(source_path, "w", encoding="utf-8") as fh:
                fh.write("---\nname: %s\ndescription: self-test fixture\n---\nSample role guidance.\n" % role)
            with open(os.path.join(codex_agents_root, "%s.toml" % role), "w", encoding="utf-8") as fh:
                fh.write('model = "gpt-5.3-codex"\nmodel_reasoning_effort = "medium"\n')

        for case in agent_cases:
            try:
                bundle = build_agent_sync_bundle(fixture_root, case["role"], "self-test-run")
                ok = bool(bundle)
                if case.get("assert_parseable"):
                    parsed = _load_toml_from_string(bundle["draft_toml_content"])
                    ok = ok and parsed.get("developer_instructions", "").startswith("Role: ")
                if case.get("assert_role_fields"):
                    role_fields_dir = os.path.join(fixture_root, ".codex-agent-role-field-check", case["role"])
                    os.makedirs(role_fields_dir)
                    role_fields_path = os.path.join(role_fields_dir, "%s.toml" % case["role"])
                    with open(role_fields_path, "w", encoding="utf-8") as fh:
                        fh.write(bundle["draft_toml_content"])
                    ok = ok and not check_codex_agent_role_fields(role_fields_dir)
                if case["name"] == "agent-manifest-build":
                    manifest = build_agent_sync_manifest(fixture_root, "self-test-run", [bundle])
                    ok = ok and bool(manifest)
                results.append({
                    "name": case["name"],
                    "status": "pass" if ok else "fail",
                    "reason": "" if ok else "agent sync payload is empty",
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
        if item.get("draft_target_path"):
            lines.append("  Draft target: `%s`" % item.get("draft_target_path"))
        if item.get("generated_files"):
            lines.append("  Generated files:")
            for path in item.get("generated_files", []):
                lines.append("  - `%s`" % path)
        if item.get("manifest_path"):
            lines.append("  Manifest: `%s`" % item.get("manifest_path"))
    return "\n".join(lines)


def load_plan(path):
    plan, _digest = load_plan_with_digest(path)
    return plan
