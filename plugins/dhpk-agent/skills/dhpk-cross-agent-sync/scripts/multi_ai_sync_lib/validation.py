"""Post-sync validation 與報告輸出。"""

import glob
import json
import os
import subprocess

from .agent_sync import (
    CLAUDE_PARITY_COVERAGE_KEYWORDS,
    CODEX_NATIVE_AGENTS,
    MANIFEST_OWNER,
    MANIFEST_SCHEMA_VERSION,
    SYNC_MANIFEST_PATH,
    claude_parity_roles,
    cursor_agent_roles,
    load_agent_sync_manifest,
)
from .constants import (
    CHECK_FAIL,
    CHECK_PASS,
    CHECK_SKIP,
    GATE_BLOCKED,
    GATE_FAIL,
    GATE_PASS,
    ROW_BLOCKED,
    ROW_FAIL,
    ROW_NOT_CONFIGURED,
    ROW_PASS,
    ROW_SKIP_INCOMPATIBLE,
    ROW_UNAVAILABLE,
)
from .sources import gemini_hook_surface_enabled, resolve_target_membership
from .utils import has_any_files, now_iso, parse_json_ok, parse_toml_like_ok, read_text, relpath, safe_exists

try:
    import tomllib
except Exception:  # pragma: no cover - py3.10 fallback
    tomllib = None
    try:
        import tomli as tomllib  # type: ignore
    except Exception:
        tomllib = None


def parse_toml_file(path):
    if tomllib is None:
        raise RuntimeError("沒有可用 TOML parser（tomllib/tomli）")
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def state_to_markdown(state):
    return {
        ROW_PASS: "OK",
        ROW_FAIL: "FAIL",
        ROW_SKIP_INCOMPATIBLE: "SKIP",
        ROW_NOT_CONFIGURED: "N/A",
        ROW_BLOCKED: "BLOCKED",
        ROW_UNAVAILABLE: "UNAVAILABLE",
        CHECK_PASS: "OK",
        CHECK_FAIL: "FAIL",
        CHECK_SKIP: "SKIP",
    }.get(state, "FAIL")


def platform_final_status(config_ok, smoke_ok, hook_state, multi_state):
    """A configured platform's overall status. FAIL beats everything; a
    documented SKIP_INCOMPATIBLE row never downgrades an otherwise-passing
    platform (design.md Decision 2)."""
    if not config_ok or not smoke_ok:
        return ROW_FAIL
    if ROW_FAIL in (hook_state, multi_state):
        return ROW_FAIL
    return ROW_PASS


def result_row(platform, config_ok, smoke_ok, hook_state, multi_state, notes, hook_reason=None, multi_reason=None):
    final = platform_final_status(config_ok, smoke_ok, hook_state, multi_state)
    return {
        "platform": platform,
        "config_load_ok": config_ok,
        "smoke_ok": smoke_ok,
        "hook_case_state": hook_state,
        "multi_agent_case_state": multi_state,
        "hook_case_ok": hook_state == ROW_PASS,
        "multi_agent_case_ok": multi_state == ROW_PASS,
        "hook_case_reason": hook_reason,
        "multi_agent_case_reason": multi_reason,
        "final_status": final,
        "notes": notes,
    }


def not_participating_row(platform, status, reason):
    """A platform absent from the resolved target set: `NOT_CONFIGURED` (never
    requested, default auto-discovery) or `BLOCKED` (explicitly requested via
    `--targets`/`--all-targets`). design.md Decision 6."""
    return {
        "platform": platform,
        "config_load_ok": False,
        "smoke_ok": False,
        "hook_case_state": status,
        "multi_agent_case_state": status,
        "hook_case_ok": False,
        "multi_agent_case_ok": False,
        "hook_case_reason": reason,
        "multi_agent_case_reason": reason,
        "final_status": status,
        "notes": [reason],
    }


def validate_claude(repo_root):
    notes = []
    cfg = os.path.join(repo_root, ".claude/settings.local.json")
    config_ok = parse_json_ok(cfg) if safe_exists(cfg) else False
    if not config_ok:
        notes.append(".claude/settings.local.json 不存在或 JSON 無效")

    smoke_ok = bool(glob.glob(os.path.join(repo_root, ".claude/skills/*/SKILL.md"))) and bool(
        glob.glob(os.path.join(repo_root, ".claude/commands/**/*.md"), recursive=True)
    )
    if not smoke_ok:
        notes.append(".claude 缺少核心 skills/commands")

    hook_dir = os.path.join(repo_root, ".claude/hooks")
    hook_reason = None
    if os.path.isdir(hook_dir):
        hook_state = ROW_PASS if has_any_files(hook_dir) else ROW_FAIL
        if hook_state == ROW_FAIL:
            notes.append(".claude/hooks 存在，但找不到 hook 檔案")
    else:
        hook_state = ROW_SKIP_INCOMPATIBLE
        hook_reason = "沒有 .claude/hooks 目錄；代表性 hook 檢查標記為 skip"
        notes.append(hook_reason)

    multi_state = ROW_PASS if bool(glob.glob(os.path.join(repo_root, ".claude/agents/*.md"))) else ROW_FAIL
    if multi_state == ROW_FAIL:
        notes.append("找不到 .claude/agents/*.md")

    return result_row("claude", config_ok, smoke_ok, hook_state, multi_state, notes, hook_reason=hook_reason)


def check_codex_agent_role_fields(agents_dir):
    """Return failures for role files missing required runtime fields."""
    if not os.path.isdir(agents_dir):
        return []

    failures = []
    required_fields = ["name", "description", "developer_instructions"]
    for path in sorted(glob.glob(os.path.join(agents_dir, "*.toml"))):
        label = os.path.basename(path)
        try:
            payload = parse_toml_file(path)
        except Exception as exc:
            failures.append("%s: 無法解析 TOML (%s)" % (label, exc))
            continue
        for field in required_fields:
            value = payload.get(field)
            if value is None:
                failures.append("%s: 缺少非空 %s" % (label, field))
                continue
            if isinstance(value, str) and not value.strip():
                failures.append("%s: 缺少非空 %s" % (label, field))

    return failures


def validate_codex(repo_root, membership=None):
    if membership is not None and not membership.get("present"):
        requested = membership.get("requested")
        status = ROW_BLOCKED if requested else ROW_NOT_CONFIGURED
        reason = ".codex/config.toml 不存在（%s）" % (
            "已明確以 --targets/--all-targets 指定" if requested else "未設定，屬 not-configured"
        )
        return not_participating_row("codex", status, reason)

    notes = []
    cfg = os.path.join(repo_root, ".codex/config.toml")
    config_ok = parse_toml_like_ok(cfg, ["[features]", "multi_agent"])
    if not config_ok:
        notes.append(".codex/config.toml 缺少 [features] 或 multi_agent")

    smoke_ok = bool(glob.glob(os.path.join(repo_root, ".codex/skills/*/SKILL.md"))) and bool(
        glob.glob(os.path.join(repo_root, ".codex/agents/*.toml"))
    )
    if not smoke_ok:
        notes.append(".codex 缺少核心 skills/agents")

    hook_state = ROW_SKIP_INCOMPATIBLE
    hook_reason = "Codex project 的 hook mapping 不支援；視為 skip-incompatible"
    notes.append(hook_reason)

    multi_state = ROW_PASS if (config_ok and bool(glob.glob(os.path.join(repo_root, ".codex/agents/*.toml")))) else ROW_FAIL
    if multi_state == ROW_FAIL:
        notes.append("Codex multi-agent 代表性檢查失敗")

    role_failures = check_codex_agent_role_fields(os.path.join(repo_root, ".codex", "agents"))
    if role_failures:
        notes.extend(role_failures)
        notes.append("Codex agent role 檔案缺少必要欄位: %d 個" % len(role_failures))
        multi_state = ROW_FAIL

    return result_row("codex", config_ok, smoke_ok, hook_state, multi_state, notes, hook_reason=hook_reason)


def validate_gemini(repo_root, membership=None):
    if membership is not None and not membership.get("present"):
        requested = membership.get("requested")
        status = ROW_BLOCKED if requested else ROW_NOT_CONFIGURED
        reason = "找不到 .gemini/commands/**/*.toml（%s）" % (
            "已明確以 --targets/--all-targets 指定" if requested else "未設定，屬 not-configured"
        )
        return not_participating_row("gemini", status, reason)

    notes = []
    cmd_files = sorted(glob.glob(os.path.join(repo_root, ".gemini/commands/**/*.toml"), recursive=True))
    config_ok = True
    if not cmd_files:
        config_ok = False
        notes.append("找不到 .gemini/commands/**/*.toml")
    else:
        for path in cmd_files:
            try:
                payload = parse_toml_file(path)
            except Exception as exc:
                config_ok = False
                notes.append("Gemini command TOML 無法解析：%s (%s)" % (relpath(path, repo_root), exc))
                break
            if "description" not in payload or "prompt" not in payload:
                config_ok = False
                notes.append("Gemini command metadata 不完整：%s" % relpath(path, repo_root))
                break

    smoke_ok = bool(glob.glob(os.path.join(repo_root, ".gemini/skills/*/SKILL.md"))) and bool(cmd_files)
    if not smoke_ok:
        notes.append(".gemini 缺少核心 skills/commands")

    hook_reason = None
    if gemini_hook_surface_enabled(repo_root):
        hook_root = os.path.join(repo_root, ".gemini/hooks")
        ext_root = os.path.join(repo_root, ".gemini/extensions")
        has_hook_files = has_any_files(hook_root) if os.path.isdir(hook_root) else False
        has_extension_files = has_any_files(ext_root) if os.path.isdir(ext_root) else False
        hook_state = ROW_PASS if (has_hook_files or has_extension_files) else ROW_FAIL
        if hook_state == ROW_FAIL:
            notes.append("Gemini hook surface 已啟用，但找不到代表性 hook artifacts")
    else:
        hook_state = ROW_SKIP_INCOMPATIBLE
        hook_reason = "Gemini hook parity 屬 repository-specific；目前視為 skip-incompatible"
        notes.append(hook_reason)

    multi_state = ROW_SKIP_INCOMPATIBLE
    multi_reason = "此 repository 佈局不提供 Gemini multi-agent parity；標記為 skip-incompatible"
    notes.append(multi_reason)

    return result_row(
        "gemini", config_ok, smoke_ok, hook_state, multi_state, notes, hook_reason=hook_reason, multi_reason=multi_reason
    )


def validate_antigravity(repo_root, membership=None):
    if membership is not None and not membership.get("present"):
        requested = membership.get("requested")
        status = ROW_BLOCKED if requested else ROW_NOT_CONFIGURED
        reason = "找不到 .agent/rules/*.md（%s）" % (
            "已明確以 --targets/--all-targets 指定" if requested else "未設定，屬 not-configured"
        )
        return not_participating_row("antigravity", status, reason)

    notes = []
    rules = sorted(glob.glob(os.path.join(repo_root, ".agent/rules/*.md")))
    config_ok = bool(rules)
    if not rules:
        notes.append("找不到 .agent/rules/*.md")
    else:
        for path in rules:
            txt = read_text(path)
            if "trigger:" not in txt:
                config_ok = False
                notes.append("Rule 缺少 trigger frontmatter：%s" % relpath(path, repo_root))
                break

    smoke_ok = bool(glob.glob(os.path.join(repo_root, ".agent/skills/*/SKILL.md"))) and bool(
        glob.glob(os.path.join(repo_root, ".agent/workflows/*.md"))
    )
    if not smoke_ok:
        notes.append(".agent 缺少核心 skills/workflows")

    hook_state = ROW_SKIP_INCOMPATIBLE
    hook_reason = "Antigravity hook parity 不支援；視為 skip-incompatible"
    notes.append(hook_reason)

    multi_state = ROW_PASS if safe_exists(os.path.join(repo_root, ".agent/workflows/review.md")) else ROW_FAIL
    if multi_state == ROW_FAIL:
        notes.append("缺少 .agent/workflows/review.md（代表性 multi-agent workflow）")

    return result_row("antigravity", config_ok, smoke_ok, hook_state, multi_state, notes, hook_reason=hook_reason)


def _cursor_package_roots(repo_root):
    portable_candidates = [
        os.path.join(repo_root, "plugins", "dhpk-agent"),
        os.path.join(repo_root, ".cursor", "plugins", "local", "dhpk-agent"),
    ]
    native_candidates = [
        os.path.join(repo_root, "plugins", "dhpk-cursor"),
        os.path.join(repo_root, ".cursor", "plugins", "local", "dhpk-cursor"),
    ]
    portable = next((root for root in portable_candidates if safe_exists(os.path.join(root, "plugin.json"))), None)
    native = next((root for root in native_candidates if safe_exists(os.path.join(root, ".cursor-plugin", "plugin.json"))), None)
    return portable, native


def _validate_cursor_package_structure(package_root, kind):
    """Run the authoritative JS projection validator, failing closed if absent.

    Installed/generated copies may not carry the repository's validator scripts.
    They must report ``UNAVAILABLE`` rather than using a weaker parser that could
    accept a malformed package as structurally valid.
    """
    if not package_root:
        return False, "Cursor package root is missing"
    script_name = "validate-agent-plugin-package.js" if kind == "portable" else "validate-cursor-plugin-package.js"
    source_root = os.path.abspath(os.path.dirname(__file__))
    script = None
    for _ in range(10):
        candidate = os.path.join(source_root, "scripts", "ci", script_name)
        if os.path.isfile(candidate):
            script = candidate
            break
        parent = os.path.dirname(source_root)
        if parent == source_root:
            break
        source_root = parent
    if script is None:
        return None, "authoritative Cursor %s package validator is unavailable" % kind
    try:
        result = subprocess.run(
            ["node", script, package_root],
            cwd=source_root,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "Cursor %s package validator is unavailable: %s" % (kind, exc)
    try:
        report = json.loads(result.stdout or "{}")
    except ValueError:
        return False, "Cursor package validator emitted invalid JSON"
    structural = report.get("structural")
    if result.returncode != 0 or structural != "PASS":
        errors = report.get("errors") or ["structural validator reported %s" % (structural or "FAIL")]
        return False, "Cursor %s package validation failed: %s" % (kind, "; ".join(str(error) for error in errors))
    return True, None


def validate_cursor(repo_root, membership=None):
    """Validate Cursor portable skills separately from Cursor-native extras.

    A standard Agent Plugin package proves only portable skills/MCP structure;
    native rules/agents/commands/hooks remain independently reportable and are
    marked SKIP_INCOMPATIBLE when the native package is not selected.
    """
    if membership is not None and not membership.get("present"):
        requested = membership.get("requested")
        status = ROW_BLOCKED if requested else ROW_NOT_CONFIGURED
        reason = "Cursor package markers are absent (%s)" % (
            "explicitly requested" if requested else "not configured"
        )
        return not_participating_row("cursor", status, reason)

    notes = []
    portable, native = _cursor_package_roots(repo_root)
    portable_valid = True
    native_valid = True
    portable_unavailable = False
    native_unavailable = False
    if portable:
        portable_valid, portable_error = _validate_cursor_package_structure(portable, "portable")
        if portable_valid is None:
            portable_unavailable = True
            portable_valid = True
            notes.append(portable_error)
        elif not portable_valid:
            notes.append(portable_error)
    if native:
        native_valid, native_error = _validate_cursor_package_structure(native, "native")
        if native_valid is None:
            native_unavailable = True
            native_valid = True
            notes.append(native_error)
        elif not native_valid:
            notes.append(native_error)
    config_ok = (portable is not None or native is not None) and portable_valid and native_valid
    if not config_ok:
        notes.append("Cursor package marker is present in configuration but no package root was found")

    portable_skills = bool(portable and glob.glob(os.path.join(portable, "skills", "*/SKILL.md")))
    portable_mcp = bool(portable and safe_exists(os.path.join(portable, "mcp.json")))
    smoke_ok = portable_skills or bool(native and glob.glob(os.path.join(native, "skills", "*/SKILL.md")))
    if not smoke_ok:
        notes.append("Cursor package has no discovered skills")
    if portable and not portable_mcp:
        notes.append("Cursor portable MCP is not configured; skills remain independently valid")

    if native_unavailable:
        hook_state = ROW_UNAVAILABLE
        hook_reason = "Cursor-native package structural validator is unavailable"
        multi_state = ROW_UNAVAILABLE
        multi_reason = "Cursor-native package structural validator is unavailable"
        notes.extend([hook_reason, multi_reason])
    elif native and not native_valid:
        hook_state = ROW_FAIL
        hook_reason = "Cursor-native package structural validation failed"
    elif native and safe_exists(os.path.join(native, "hooks", "hooks.json")):
        hook_state = ROW_PASS
        hook_reason = "Cursor-native hooks manifest is present"
    else:
        hook_state = ROW_SKIP_INCOMPATIBLE
        hook_reason = "Cursor-native hooks are not selected; portable Agent Plugin has no native hook claim"
        notes.append(hook_reason)

    if native_unavailable:
        multi_state = ROW_UNAVAILABLE
        multi_reason = "Cursor-native package structural validator is unavailable"
    elif native and cursor_agent_roles(repo_root):
        multi_state = ROW_PASS
        multi_reason = "Cursor-native agent definitions are discoverable (navigation/receipts excluded)"
    else:
        multi_state = ROW_SKIP_INCOMPATIBLE
        multi_reason = "Cursor-native agents are unavailable; portable skills remain supported"
        notes.append(multi_reason)

    row = result_row(
        "cursor", config_ok, smoke_ok, hook_state, multi_state, notes,
        hook_reason=hook_reason, multi_reason=multi_reason,
    )
    if row["final_status"] == ROW_PASS and (portable_unavailable or native_unavailable):
        row["final_status"] = ROW_UNAVAILABLE
    portable_status = ROW_UNAVAILABLE if portable_unavailable else (ROW_FAIL if portable and not portable_valid else (ROW_PASS if portable and portable_skills else (ROW_FAIL if portable else ROW_NOT_CONFIGURED)))
    mcp_status = ROW_UNAVAILABLE if portable_unavailable and portable_mcp else (ROW_FAIL if portable and portable_mcp and not portable_valid else (ROW_PASS if portable_mcp else (ROW_NOT_CONFIGURED if portable else ROW_SKIP_INCOMPATIBLE)))
    native_status = ROW_UNAVAILABLE if native_unavailable else (ROW_FAIL if native and not native_valid else (ROW_PASS if native else ROW_SKIP_INCOMPATIBLE))
    row["capabilities"] = [
        {"id": "cursor.portable.skills", "status": portable_status, "fallback": "agent-plugin", "reason": "portable Agent Skills package"},
        {"id": "cursor.portable.mcp", "status": mcp_status, "fallback": "no-mcp-json", "reason": "optional MCP is independently configured"},
        {"id": "cursor.native.rules", "status": native_status if native and safe_exists(os.path.join(native, "rules")) else ROW_SKIP_INCOMPATIBLE, "fallback": "portable-skills", "reason": "Cursor rules"},
        {"id": "cursor.native.agents", "status": ROW_UNAVAILABLE if native_unavailable else (ROW_PASS if native and cursor_agent_roles(repo_root) else ROW_SKIP_INCOMPATIBLE), "fallback": "portable-skills", "reason": "Cursor agents"},
        {"id": "cursor.native.commands", "status": native_status if native and safe_exists(os.path.join(native, "commands")) else ROW_SKIP_INCOMPATIBLE, "fallback": "portable-skills", "reason": "Cursor commands"},
        {"id": "cursor.native.hooks", "status": hook_state, "fallback": "SKIP_INCOMPATIBLE", "reason": hook_reason},
        {"id": "cursor.native.variables", "status": ROW_UNAVAILABLE if native_unavailable else (ROW_PASS if native and safe_exists(os.path.join(native, ".cursor-plugin", "plugin.json")) else ROW_SKIP_INCOMPATIBLE), "fallback": "no-client-variables", "reason": "Cursor variables schema"},
    ]
    return row


def run_policy_checks(repo_root, codex_present=True):
    """Task 5: 執行三類政策型檢查（path canonicalization、profile compatibility、agent parity）。

    `codex_present` reflects whether Codex participates in this run at all
    (configured, explicitly requested-and-present, or included by
    `--all-targets`) — when False (NOT_CONFIGURED, BLOCKED, or excluded by an
    explicit `--targets` list that omits codex), the Codex-specific parity
    checks below must not independently fail the gate (issue #89: an absent
    optional platform must never leak back in through a side channel)."""
    checks = []

    # --- 5.1 Canonical path check ---
    agent_skills = os.path.join(repo_root, ".agent", "skills")
    agents_skills = os.path.join(repo_root, ".agents", "skills")
    has_canonical = os.path.isdir(agent_skills) and bool(os.listdir(agent_skills))
    has_legacy_only = (not has_canonical) and os.path.isdir(agents_skills) and bool(os.listdir(agents_skills))

    if has_canonical:
        checks.append({"id": "path.canonical", "level": "info", "status": CHECK_PASS,
                       "message": "`.agent/skills` 為 canonical path，存在且有內容。"})
    elif has_legacy_only:
        checks.append({"id": "path.canonical", "level": "warn", "status": CHECK_FAIL,
                       "message": "只有 legacy alias `.agents/skills` 存在，需遷移至 `.agent/skills`。"})
    else:
        checks.append({"id": "path.canonical", "level": "warn", "status": CHECK_SKIP,
                       "message": "`.agent/skills` 與 `.agents/skills` 皆不存在。"})

    # --- 5.2 php-pro profile compatibility check ---
    php_pro_paths = [
        os.path.join(repo_root, ".agent", "skills", "php-pro", "SKILL.md"),
        os.path.join(repo_root, ".codex", "skills", "php-pro", "SKILL.md"),
        os.path.join(repo_root, ".claude", "skills", "php-pro", "SKILL.md"),
        os.path.join(repo_root, ".gemini", "skills", "php-pro", "SKILL.md"),
    ]
    profile_ok = True
    profile_issues = []
    for p in php_pro_paths:
        if not safe_exists(p):
            continue
        content = read_text(p)
        # Profile Override 區塊存在即視為對齊
        if "Profile Override" not in content and ("PHP 5.6" not in content and "legacy" not in content.lower()):
            profile_ok = False
            profile_issues.append(relpath(p, repo_root))

    if profile_ok:
        checks.append({"id": "profile.php_pro", "level": "fail", "status": CHECK_PASS,
                       "message": "php-pro SKILL.md 均含 PHP 5.6 legacy profile 對齊。"})
    else:
        checks.append({"id": "profile.php_pro", "level": "fail", "status": CHECK_FAIL,
                       "message": "php-pro SKILL.md 缺少 PHP 5.6 profile override: %s" % ", ".join(profile_issues)})

    # --- 5.3 Agent parity checks ---
    # Task 4.2/4.3: the sync manifest is a parity-apply receipt, not a standard
    # Codex installer requirement — only require it when there is at least one
    # Claude parity role to sync (design.md Decision 4 / multi-ai-sync-manifest-provenance).
    parity_roles = claude_parity_roles(repo_root)
    manifest = load_agent_sync_manifest(repo_root)
    manifest_issues = []
    coverage_issues = []
    manifest_required = codex_present and bool(parity_roles)

    # Task 4.3: which agent-ownership contract this Codex target selected, and
    # the evidence used to select it (multi-ai-sync-manifest-provenance spec).
    # A manifest that exists is always "parity_managed" — including when its
    # roles are currently empty (a stale receipt candidate, design.md risk
    # register) — so this label never contradicts the manifest check below.
    if not codex_present:
        ownership_contract = "not_configured"
        ownership_evidence = "Codex is not participating in this run (NOT_CONFIGURED/BLOCKED/excluded)"
    elif manifest:
        ownership_contract = "parity_managed"
        ownership_evidence = (
            "%d current Claude parity role(s)" % len(parity_roles)
            if parity_roles
            else "existing %s with no current .claude/agents/*.md source (stale receipt candidate)" % SYNC_MANIFEST_PATH
        )
    elif parity_roles:
        ownership_contract = "parity_managed"
        ownership_evidence = "%d Claude parity role(s) under .claude/agents/*.md, manifest not yet generated" % len(parity_roles)
    else:
        ownership_contract = "standard_install"
        ownership_evidence = "no .claude/agents/*.md source and no %s" % SYNC_MANIFEST_PATH

    if not manifest:
        if manifest_required:
            manifest_issues.append("找不到 %s" % SYNC_MANIFEST_PATH)
        manifest_roles = {}
    else:
        if manifest.get("owner") != MANIFEST_OWNER:
            manifest_issues.append(
                "manifest owner 不符：預期 %s，實際 %s" % (MANIFEST_OWNER, manifest.get("owner"))
            )
        if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
            manifest_issues.append(
                "manifest schema_version 不符：預期 %s，實際 %s" % (MANIFEST_SCHEMA_VERSION, manifest.get("schema_version"))
            )
        manifest_roles = {}
        for entry in manifest.get("roles", []):
            source_agent = entry.get("source_agent", "")
            role = os.path.splitext(os.path.basename(source_agent))[0]
            if role:
                manifest_roles[role] = entry

    for role in (parity_roles if codex_present else []):
        toml_path = os.path.join(repo_root, ".codex", "agents", "%s.toml" % role)
        if not safe_exists(toml_path):
            coverage_issues.append("%s.toml 不存在" % role)
            continue

        entry = manifest_roles.get(role)
        if not entry:
            manifest_issues.append("%s 缺少 manifest entry" % role)
            continue

        mirror_md = entry.get("mirror_md")
        if not mirror_md or not safe_exists(os.path.join(repo_root, mirror_md)):
            manifest_issues.append("%s mirror_md 缺失或不存在" % role)

        for ref in entry.get("mirrored_refs", []):
            if not safe_exists(os.path.join(repo_root, ref)):
                manifest_issues.append("%s mirrored ref 不存在: %s" % (role, ref))

        if "nonportable_sources" not in entry:
            manifest_issues.append("%s 缺少 nonportable_sources 欄位" % role)

        keywords = entry.get("coverage_keywords") or CLAUDE_PARITY_COVERAGE_KEYWORDS.get(role, [])
        content = read_text(toml_path)
        missing = [kw for kw in keywords if kw not in content]
        if missing:
            coverage_issues.append("%s 缺少關鍵字: %s" % (role, ", ".join(missing)))
        if "This file is self-contained" not in content:
            coverage_issues.append("%s 未標記 self-contained runtime contract" % role)

    if manifest_issues:
        checks.append({"id": "parity.agents.manifest", "level": "fail", "status": CHECK_FAIL,
                       "message": "Agent parity manifest 不完整: %s" % "; ".join(manifest_issues)})
    elif not codex_present:
        checks.append({"id": "parity.agents.manifest", "level": "fail", "status": CHECK_SKIP,
                       "message": "Codex 未參與本次 run（NOT_CONFIGURED/BLOCKED/excluded）；不檢查 sync manifest。"})
    elif manifest is None and not parity_roles:
        checks.append({"id": "parity.agents.manifest", "level": "fail", "status": CHECK_SKIP,
                       "message": "沒有 Claude parity agent 來源（.claude/agents/*.md）；"
                                  "此 repository 屬標準 Codex 安裝，不需要 %s。" % SYNC_MANIFEST_PATH})
    else:
        checks.append({"id": "parity.agents.manifest", "level": "fail", "status": CHECK_PASS,
                       "message": "Claude parity manifest 與 mirrored references 完整。"})

    if coverage_issues:
        checks.append({"id": "parity.agents.coverage", "level": "fail", "status": CHECK_FAIL,
                       "message": "Agent self-contained coverage 不完整: %s" % "; ".join(coverage_issues)})
    elif not codex_present:
        checks.append({"id": "parity.agents.coverage", "level": "fail", "status": CHECK_SKIP,
                       "message": "Codex 未參與本次 run（NOT_CONFIGURED/BLOCKED/excluded）；不檢查 coverage。"})
    else:
        checks.append({"id": "parity.agents.coverage", "level": "fail", "status": CHECK_PASS,
                       "message": "Claude parity agents 均通過 self-contained coverage 檢查。"})

    checks.append({"id": "parity.agents.codex_native", "level": "info", "status": CHECK_PASS,
                   "message": "Codex-native agents 已排除於 Claude parity: %s" % ", ".join(CODEX_NATIVE_AGENTS)})

    checks.append({"id": "parity.agents.ownership_contract", "level": "info", "status": CHECK_PASS,
                   "message": "Codex agent ownership contract: %s (%s)" % (ownership_contract, ownership_evidence)})

    return checks


def run_validation(repo_root, change_id=None, targets=None, all_targets=False):
    membership = resolve_target_membership(repo_root, targets=targets, all_targets=all_targets)

    rows = [validate_claude(repo_root)]
    validators = {"codex": validate_codex, "gemini": validate_gemini, "antigravity": validate_antigravity, "cursor": validate_cursor}
    for platform, entry in membership.items():
        rows.append(validators[platform](repo_root, entry))

    gate = GATE_PASS
    any_blocked = False
    any_unavailable = False
    any_skip_incompatible = False
    for row in rows:
        if row["final_status"] == ROW_FAIL:
            gate = GATE_FAIL
        elif row["final_status"] == ROW_BLOCKED:
            any_blocked = True
        elif row["final_status"] == ROW_UNAVAILABLE:
            any_unavailable = True
        if row["hook_case_state"] == ROW_SKIP_INCOMPATIBLE or row["multi_agent_case_state"] == ROW_SKIP_INCOMPATIBLE:
            any_skip_incompatible = True
    if gate != GATE_FAIL and any_blocked:
        gate = GATE_BLOCKED
    elif gate == GATE_PASS and any_unavailable:
        gate = GATE_BLOCKED

    # Task 5: 政策型檢查（既有機制，仍可將 gate 升級為 FAIL；不產生 BLOCKED）。
    # codex_present 反映 Codex 是否參與本次 run；NOT_CONFIGURED/BLOCKED/被
    # explicit --targets 排除時皆為 False，避免 issue #89 的缺席污染經由
    # policy checks 側路徑重新滲入 gate。
    codex_present = membership.get("codex", {}).get("present", False)
    policy_checks = run_policy_checks(repo_root, codex_present=codex_present)
    policy_partial = False
    for check in policy_checks:
        if check["status"] == CHECK_FAIL and check["level"] == "fail":
            gate = GATE_FAIL
        elif check["status"] == CHECK_FAIL and check["level"] == "warn":
            policy_partial = True

    # Task 2.5/2.7: legacy_gate — deprecated PASS/PARTIAL/FAIL compatibility
    # field for one release (design.md Decision 6). Removal-pending; every
    # in-repo consumer reads `gate`, not `legacy_gate`.
    if gate in (GATE_FAIL, GATE_BLOCKED):
        legacy_gate = "FAIL"
    elif any_skip_incompatible or policy_partial:
        legacy_gate = "PARTIAL"
    else:
        legacy_gate = "PASS"

    generated_at = now_iso()
    return {
        "generated_at": generated_at,
        "policy_source": {
            "change_id": change_id or "hardening-ai-config-alignment-2026-03-04",
            "generated_at": generated_at,
        },
        "results": rows,
        "policy_checks": policy_checks,
        "gate": gate,
        "legacy_gate": legacy_gate,
    }


def render_validation_markdown(report):
    lines = []
    lines.append("# Post-Sync Validation 報告")
    lines.append("")
    lines.append("產生時間（generated_at）: `%s`" % report["generated_at"])
    policy_source = report.get("policy_source")
    if policy_source:
        lines.append("Policy Source: change `%s` @ `%s`" % (
            policy_source.get("change_id", "unknown"),
            policy_source.get("generated_at", report["generated_at"]),
        ))
    lines.append("")
    lines.append("| Platform | Config | Smoke | Hooks | Multi-Agent | Final |")
    lines.append("|---|---|---|---|---|---|")
    for row in report["results"]:
        lines.append("| %s | %s | %s | %s | %s | %s |" % (
            row["platform"],
            "OK" if row["config_load_ok"] else "FAIL",
            "OK" if row["smoke_ok"] else "FAIL",
            state_to_markdown(row["hook_case_state"]),
            state_to_markdown(row["multi_agent_case_state"]),
            row["final_status"],
        ))
    lines.append("")

    lines.append("## Gate Criteria")
    lines.append("")
    lines.append("- `PASS`: 所有 configured/applicable 平台檢查皆為 `PASS`；`NOT_CONFIGURED`/`SKIP_INCOMPATIBLE` 不影響 gate。")
    lines.append("- `FAIL`: 任一 configured（或明確要求）平台的 applicable 檢查為 `FAIL`。優先於 `BLOCKED`。")
    lines.append("- `BLOCKED`: 沒有 `FAIL`，但至少一個以 `--targets`/`--all-targets` 明確要求的平台完全缺席。")
    lines.append("- `NOT_CONFIGURED`: 平台未被明確要求且缺席（預設自動探索情境）；不影響 gate，僅供可見性。")
    lines.append("- `SKIP_INCOMPATIBLE`: 平台已設定，但特定能力依政策矩陣不支援；不影響 gate，僅供可見性。")
    lines.append("- `UNAVAILABLE`: 對應 client/tooling 不存在；不得轉為 `PASS`。")
    lines.append("")

    lines.append("## Notes")
    lines.append("")
    for row in report["results"]:
        if row.get("notes"):
            lines.append("### %s" % row["platform"])
            for note in row["notes"]:
                lines.append("- %s" % note)
            lines.append("")

    # Task 5: policy checks 輸出
    policy_checks = report.get("policy_checks", [])
    if policy_checks:
        lines.append("## Policy Checks")
        lines.append("")
        lines.append("| ID | Level | Status | Message |")
        lines.append("|---|---|---|---|")
        for check in policy_checks:
            status_label = state_to_markdown(check["status"])
            lines.append("| `%s` | %s | %s | %s |" % (
                check["id"], check["level"].upper(), status_label, check["message"]
            ))
        lines.append("")

    lines.append("## Gate")
    lines.append("")
    lines.append("%s" % report["gate"])
    lines.append("")
    lines.append("_Deprecated compatibility field (removal-pending): `legacy_gate` = `%s`_" % report.get("legacy_gate", "unknown"))
    return "\n".join(lines)
