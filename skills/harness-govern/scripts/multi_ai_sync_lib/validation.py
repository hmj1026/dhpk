"""Post-sync validation 與報告輸出。"""

import glob
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile

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
    ROW_NOT_RUN,
    ROW_PASS,
    ROW_SKIP_INCOMPATIBLE,
    ROW_UNAVAILABLE,
)
from .cursor_project_local import validate_cursor_project_local
from .sources import resolve_target_membership
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
        ROW_NOT_RUN: "NOT_RUN",
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
    if ROW_UNAVAILABLE in (hook_state, multi_state):
        return ROW_UNAVAILABLE
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


AGY_MODELS = {"inherit", "flash_lite", "flash", "pro"}
AGY_TOOLS = {
    "read_file", "view_file", "write_to_file", "replace_file_content",
    "multi_replace_file_content", "run_command", "grep_search",
    "list_dir", "search_web", "read_url_content", "invoke_subagent",
}
AGY_FRONTMATTER_KEYS = {"name", "description", "tools", "model"}
AGY_PACKAGE_SCHEMA = "dhpk.agy-plugin.v1"
AGY_PROVENANCE_SCHEMA = "dhpk.platform-provenance.v1"
AGY_PACKAGE_METADATA = {"plugin.json", "provenance.json", "fingerprints.json"}
AGY_OPTIONAL_FILES = {"mcp_config.json", "hooks.json"}
AGY_COMPONENT_ROOTS = {"agents", "rules", "skills"}
AGY_RESERVED_AGENT_FILES = {"index.md", "readme.md", "provenance.md", "fingerprints.md"}
AGY_SHA256 = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)
AGY_COMMIT = re.compile(r"^[a-f0-9]{40}$", re.IGNORECASE)
AGY_SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
AGY_SECRET_PATTERNS = (
    re.compile(r"\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b", re.IGNORECASE),
    re.compile(r"\b(?:https?|postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@", re.IGNORECASE),
    re.compile(r"[\"']?(?:authorization|proxy-authorization)[\"']?\s*[:=]\s*[\"']?(?:bearer|basic)\s+[\"']?[^\"'\s,}]+", re.IGNORECASE),
)
AGY_SESSION_ALLOWLIST = (
    ".gemini/oauth_creds.json",
    ".gemini/google_accounts.json",
    ".gemini/antigravity-cli/antigravity-oauth-token",
)
AGY_REASON_CODES = frozenset({
    "READY",
    "PACKAGE_INVALID",
    "PACKAGE_UNAVAILABLE",
    "TOOL_UNAVAILABLE",
    "SANDBOX_UNAVAILABLE",
    "SESSION_UNAVAILABLE",
    "AUTH_REQUIRED",
    "DNS_UNAVAILABLE",
    "TRANSPORT_UNAVAILABLE",
    "TIMEOUT",
    "CLI_INCOMPATIBLE",
    "OUTPUT_LIMIT",
    "PROBE_NOT_RUN",
    "PROBE_FAILED",
})
AGY_DIAGNOSTIC_MESSAGES = {
    "AUTH_REQUIRED": "<redacted-client-output> (authentication required)",
    "DNS_UNAVAILABLE": "<redacted-client-output> (dns resolution failed)",
    "TIMEOUT": "<redacted-client-output> (request timed out)",
    "TRANSPORT_UNAVAILABLE": "<redacted-client-output> (network transport unavailable)",
    "SANDBOX_UNAVAILABLE": "<redacted-client-output> (sandbox unavailable)",
    "SESSION_UNAVAILABLE": "<redacted-client-output> (session unavailable)",
    "CLI_INCOMPATIBLE": "<redacted-client-output> (unsupported CLI route)",
    "OUTPUT_LIMIT": "<redacted-client-output> (output limit exceeded)",
    "PACKAGE_INVALID": "<redacted-client-output> (package invalid)",
    "PACKAGE_UNAVAILABLE": "<redacted-client-output> (package unavailable)",
    "TOOL_UNAVAILABLE": "<redacted-client-output> (tool unavailable)",
    "PROBE_NOT_RUN": "<redacted-client-output> (probe not run)",
    "READY": "<redacted-client-output> (ready)",
    "PROBE_FAILED": "<redacted-client-output>",
}
AGY_MAX_DIAGNOSTIC_LENGTH = 800
AGY_MAX_OUTPUT_BYTES = 256 * 1024
AGY_OUTPUT_LIMIT_MARKER = "__DHPK_AGY_OUTPUT_LIMIT__"
AGY_SENSITIVE_ASSIGNMENT = re.compile(
    r"([\"']?)(?:access[_-]?token|refresh[_-]?token|oauth[_-]?token|token|password|secret|api[_-]?key|credential)\1\s*[:=]\s*"
    r"(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s,;}\]]+)",
    re.IGNORECASE,
)


def _agy_contains_secret(content):
    text = content.decode("utf-8", errors="replace") if isinstance(content, bytes) else str(content)
    return any(pattern.search(text) for pattern in AGY_SECRET_PATTERNS)


def _agy_redact_diagnostic(value, reason_code=None):
    """Return only a fixed reason-class diagnostic, never client output.

    AGY emits free-form stderr that may contain private paths, host overlays,
    prompts, tool payloads, or credentials. Token substitution is not a
    sufficient boundary, so persist a bounded placeholder plus the already
    classified reason code instead of retaining any part of the raw text.
    """
    code = str(reason_code or "PROBE_FAILED").upper()
    return AGY_DIAGNOSTIC_MESSAGES.get(code, AGY_DIAGNOSTIC_MESSAGES["PROBE_FAILED"])[-AGY_MAX_DIAGNOSTIC_LENGTH:]


def _agy_reason_code(status, reason):
    """Map bounded AGY diagnostics to a stable, non-sensitive reason class."""
    text = ("" if reason is None else str(reason)).lower()
    if status == ROW_PASS:
        return "READY"
    if status == ROW_NOT_RUN:
        return "PROBE_NOT_RUN"
    if status == ROW_SKIP_INCOMPATIBLE:
        return "CLI_INCOMPATIBLE"
    if "authentication" in text or "unauthorized" in text or "credential" in text:
        return "AUTH_REQUIRED"
    if "session" in text or "logged-in" in text or "login" in text:
        return "SESSION_UNAVAILABLE"
    if "dns" in text or "resolve" in text or "eai_" in text or "name resolution" in text:
        return "DNS_UNAVAILABLE"
    if "timed out" in text or "timeout" in text:
        return "TIMEOUT"
    if "network" in text or "connection" in text or "transport" in text or "socket" in text:
        return "TRANSPORT_UNAVAILABLE"
    if "unknown argument" in text or "unknown command" in text or "not defined" in text:
        return "CLI_INCOMPATIBLE"
    if "sandbox" in text or "bwrap" in text or "namespace" in text:
        return "SANDBOX_UNAVAILABLE"
    if "output" in text and ("limit" in text or "exceed" in text):
        return "OUTPUT_LIMIT"
    if "package" in text and ("missing" in text or "failed" in text or "invalid" in text):
        return "PACKAGE_INVALID"
    if status == ROW_UNAVAILABLE:
        return "TOOL_UNAVAILABLE"
    return "PROBE_FAILED"


def _agy_runtime_details(session_files, reason_code=None, diagnostic=None):
    """Return bounded session metadata, reason code, and redacted diagnostics."""
    details = {
        "session_files": list(session_files or [])[:len(AGY_SESSION_ALLOWLIST)],
        "session_file_count": len(session_files or []),
    }
    if reason_code in AGY_REASON_CODES:
        details["reason_code"] = reason_code
    if diagnostic:
        safe_diagnostic = _agy_redact_diagnostic(diagnostic, reason_code)
        if safe_diagnostic:
            details["diagnostic"] = safe_diagnostic
    return details


def _agy_package_root(repo_root):
    candidates = [
        os.path.join(repo_root, "plugins", "dhpk-agy"),
        os.path.join(repo_root, ".gemini", "config", "plugins", "dhpk"),
    ]
    return next((candidate for candidate in candidates if safe_exists(os.path.join(candidate, "plugin.json"))), None)


def _agy_frontmatter(path):
    """Validate the small, deliberately closed AGY agent frontmatter contract."""
    text = read_text(path)
    match = re.match(r"^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)", text)
    if not match:
        return False, "missing AGY frontmatter"
    values = {}
    for line in match.group(1).splitlines():
        key_match = re.match(r"^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$", line)
        if not key_match:
            continue
        key, value = key_match.group(1), key_match.group(2).strip()
        if key not in AGY_FRONTMATTER_KEYS:
            return False, "unsupported AGY frontmatter field: %s" % key
        values[key] = value
    if not values.get("name") or not values.get("description"):
        return False, "AGY agent requires name and description"
    model = values.get("model", "inherit").strip("'\"")
    if model not in AGY_MODELS:
        return False, "unsupported AGY model: %s" % model
    tools = values.get("tools")
    if tools is None:
        return False, "AGY agent requires tools"
    raw = tools.strip()
    if raw.startswith("[") and raw.endswith("]"):
        raw = raw[1:-1]
    tool_names = [item.strip().strip("'\"") for item in raw.split(",") if item.strip()]
    for tool in tool_names:
        if tool not in AGY_TOOLS and not tool.startswith("mcp_"):
            return False, "unsupported AGY tool: %s" % tool
    return True, None


def _agy_walk_package(package_root):
    """Enumerate a physical AGY package without following any symlink."""
    errors = []
    files = []
    root = os.path.abspath(package_root)
    root_real = os.path.realpath(root)

    def inside(candidate):
        candidate_real = os.path.realpath(candidate)
        try:
            return os.path.commonpath([root_real, candidate_real]) == root_real
        except ValueError:
            return False

    def walk(directory, prefix=""):
        try:
            entries = sorted(os.scandir(directory), key=lambda entry: entry.name)
        except OSError as exc:
            errors.append("cannot read AGY package directory %s: %s" % (prefix or ".", exc))
            return
        for entry in entries:
            relative = "%s/%s" % (prefix, entry.name) if prefix else entry.name
            candidate = entry.path
            if entry.is_symlink():
                errors.append("AGY package symlink is not allowed: %s" % relative)
                continue
            if not inside(candidate):
                errors.append("AGY package path escapes root: %s" % relative)
                continue
            if entry.is_dir(follow_symlinks=False):
                walk(candidate, relative)
            elif entry.is_file(follow_symlinks=False):
                files.append(relative)
            else:
                errors.append("unsupported AGY package entry: %s" % relative)

    walk(root)
    return sorted(files), errors


def _agy_read_json(path, label, errors):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            value = json.load(fh)
    except (OSError, ValueError) as exc:
        errors.append("AGY %s is missing or invalid: %s" % (label, exc))
        return None
    return value


def _agy_validate_manifest(manifest, errors):
    if not isinstance(manifest, dict) or manifest.get("name") != "dhpk":
        errors.append("AGY plugin.json name must be dhpk")
        return
    if not isinstance(manifest.get("version"), str) or not re.match(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$", manifest["version"]):
        errors.append("AGY plugin.json version must be SemVer")
    expected = {"agents": "agents", "rules": "rules", "skills": "skills"}
    for key, root in expected.items():
        values = manifest.get(key)
        if not isinstance(values, list) or values != ["./%s/" % root]:
            errors.append("AGY plugin.json %s must declare only ./%s/" % (key, root))


def _validate_agy_package_structure(package_root):
    errors = []
    if not package_root or not os.path.isdir(package_root) or os.path.islink(package_root):
        return False, ["AGY package root must be a physical directory"], []

    files, walk_errors = _agy_walk_package(package_root)
    errors.extend(walk_errors)
    manifest = _agy_read_json(os.path.join(package_root, "plugin.json"), "plugin.json", errors)
    _agy_validate_manifest(manifest, errors)

    for component in sorted(AGY_COMPONENT_ROOTS):
        component_path = os.path.join(package_root, component)
        if not os.path.isdir(component_path) or os.path.islink(component_path):
            errors.append("AGY package %s directory is missing or unsafe" % component)

    agents = []
    agent_files = []
    rule_files = []
    skill_files = []
    for relative in files:
        base = relative.split("/", 1)[0]
        if relative in AGY_PACKAGE_METADATA or relative in AGY_OPTIONAL_FILES:
            continue
        if base not in AGY_COMPONENT_ROOTS:
            errors.append("undeclared AGY package component: %s" % relative)
            continue
        if base == "agents":
            name = relative.split("/", 1)[1] if "/" in relative else ""
            if "/" in name or not name.endswith(".md"):
                errors.append("AGY agent path is not a flat Markdown file: %s" % relative)
                continue
            if name.lower() in AGY_RESERVED_AGENT_FILES:
                continue
            agent_files.append(relative)
        elif base == "rules":
            if relative.count("/") != 1 or not relative.endswith(".md"):
                errors.append("AGY rule path is not a flat Markdown file: %s" % relative)
                continue
            rule_files.append(relative)
        elif base == "skills":
            if re.match(r"^skills/[^/]+/SKILL\.md$", relative):
                skill_files.append(relative)
            elif re.match(r"^skills/[^/]+/references/.+$", relative):
                pass
            elif re.match(r"^skills/[^/]+/scripts/.+$", relative):
                pass
            else:
                errors.append("AGY skill path must be <skill>/SKILL.md, <skill>/references/..., or <skill>/scripts/...: %s" % relative)
                continue

    for relative in sorted(agent_files):
        name = relative.split("/", 1)[1]
        candidate = os.path.join(package_root, relative)
        ok, reason = _agy_frontmatter(candidate)
        if not ok:
            errors.append("%s: %s" % (name, reason))
        agents.append(name)
    if not agents:
        errors.append("AGY package contains no discoverable agents")
    if not rule_files:
        errors.append("AGY package contains no selected rules")
    if not skill_files:
        errors.append("AGY package contains no selected skills")

    fingerprints = _agy_read_json(os.path.join(package_root, "fingerprints.json"), "fingerprints.json", errors)
    if not isinstance(fingerprints, dict) or fingerprints.get("schema") != AGY_PACKAGE_SCHEMA or not isinstance(fingerprints.get("files"), dict):
        errors.append("AGY fingerprints.json must use %s" % AGY_PACKAGE_SCHEMA)
        fingerprint_map = {}
    else:
        fingerprint_map = fingerprints["files"]
    actual_files = {relative for relative in files if relative not in {"provenance.json", "fingerprints.json"}}
    if set(fingerprint_map) != actual_files:
        errors.append("AGY fingerprints do not cover exactly the package files")
    for relative in sorted(actual_files):
        expected_hash = fingerprint_map.get(relative)
        if not isinstance(expected_hash, str) or not AGY_SHA256.match(expected_hash):
            errors.append("AGY fingerprint is not SHA-256: %s" % relative)
            continue
        with open(os.path.join(package_root, relative), "rb") as fh:
            content = fh.read()
            actual_hash = hashlib.sha256(content).hexdigest()
        if _agy_contains_secret(content):
            errors.append("possible secret in AGY package file: %s" % relative)
        if actual_hash != expected_hash:
            errors.append("AGY fingerprint does not match output: %s" % relative)

    provenance = _agy_read_json(os.path.join(package_root, "provenance.json"), "provenance.json", errors)
    if not isinstance(provenance, dict):
        errors.append("AGY provenance must be an object")
    else:
        if provenance.get("surface") != "agy-plugin":
            errors.append("AGY provenance surface must be agy-plugin")
        if provenance.get("schema") != AGY_PACKAGE_SCHEMA:
            errors.append("AGY provenance schema must be %s" % AGY_PACKAGE_SCHEMA)
        if provenance.get("provenanceSchema") != AGY_PROVENANCE_SCHEMA:
            errors.append("AGY provenance schema marker is invalid")
        if provenance.get("owner") != "plugins/dhpk-agy" or provenance.get("packageRoot") != "plugins/dhpk-agy":
            errors.append("AGY provenance owner/packageRoot is not owner-scoped")
        if not isinstance(provenance.get("sourceVersion"), str) or not AGY_SEMVER.match(provenance["sourceVersion"]):
            errors.append("AGY provenance sourceVersion must be SemVer")
        if not isinstance(provenance.get("sourceCommit"), str) or not AGY_COMMIT.match(provenance["sourceCommit"]):
            errors.append("AGY provenance sourceCommit must be a 40-character commit SHA")
        if not isinstance(provenance.get("inventoryDigest"), str) or not AGY_SHA256.match(provenance["inventoryDigest"]):
            errors.append("AGY provenance inventoryDigest must be a SHA-256 digest")
        if not isinstance(provenance.get("generatorVersion"), str) or not AGY_SEMVER.match(provenance["generatorVersion"]):
            errors.append("AGY provenance generatorVersion must be SemVer")
        transform = provenance.get("transform")
        if not isinstance(transform, dict) or not isinstance(transform.get("id"), str) or not isinstance(transform.get("version"), str):
            errors.append("AGY provenance transform identity is missing")
        if provenance.get("fingerprints") != fingerprint_map:
            errors.append("AGY provenance fingerprints do not match fingerprints.json")
        selected = provenance.get("selectedIds")
        if not isinstance(selected, dict) or not all(isinstance(selected.get(key), list) for key in ("agents", "rules", "skills")):
            errors.append("AGY provenance selectedIds are missing")
        else:
            if set(selected["agents"]) != set(os.path.basename(relative) for relative in agent_files):
                errors.append("AGY provenance agent IDs do not match package agents")
            if set(selected["rules"]) != set(rule_files):
                errors.append("AGY provenance rule IDs do not match package rules")
            skill_dirs = set(relative.split("/")[1] for relative in skill_files)
            if len(selected["skills"]) != len(skill_dirs) or len(set(selected["skills"])) != len(selected["skills"]):
                errors.append("AGY provenance skill IDs do not match package skills")

    return len(errors) == 0, errors, agents


def _agy_clone_session(host_home):
    if not isinstance(host_home, str) or not os.path.isabs(host_home):
        return None, []
    probe_home = tempfile.mkdtemp(prefix="dhpk-agy-home-")
    copied = []
    try:
        for relative in AGY_SESSION_ALLOWLIST:
            source = os.path.join(host_home, relative)
            source_parts = relative.replace("/", os.sep).split(os.sep)
            current = os.path.abspath(host_home)
            try:
                if os.path.islink(current):
                    continue
                for part in source_parts:
                    current = os.path.join(current, part)
                    if os.path.islink(current):
                        current = None
                        break
                if current is None or not os.path.isfile(source) or os.path.islink(source):
                    continue
                expected_realpath = os.path.realpath(source)
                destination = os.path.join(probe_home, relative)
                os.makedirs(os.path.dirname(destination), mode=0o700, exist_ok=True)
                nofollow = getattr(os, "O_NOFOLLOW", 0)
                source_fd = os.open(source, os.O_RDONLY | nofollow)
                try:
                    source_stat = os.fstat(source_fd)
                    if not stat.S_ISREG(source_stat.st_mode):
                        continue
                    source_lstat = os.lstat(source)
                    if (getattr(source_lstat, "st_dev", None) != getattr(source_stat, "st_dev", None)
                            or getattr(source_lstat, "st_ino", None) != getattr(source_stat, "st_ino", None)):
                        continue
                    if os.path.realpath(source) != expected_realpath:
                        continue
                    with os.fdopen(source_fd, "rb", closefd=False) as source_stream:
                        content = source_stream.read()
                finally:
                    os.close(source_fd)
                destination_fd = os.open(
                    destination,
                    os.O_WRONLY | os.O_CREAT | os.O_TRUNC | nofollow,
                    0o600,
                )
                try:
                    with os.fdopen(destination_fd, "wb", closefd=False) as destination_stream:
                        destination_stream.write(content)
                finally:
                    os.close(destination_fd)
                os.chmod(destination, 0o600)
                copied.append(relative)
            except (OSError, ValueError):
                continue
        return probe_home, copied
    except Exception:
        shutil.rmtree(probe_home, ignore_errors=True)
        raise


def _verified_executable(name):
    candidate = shutil.which(name)
    if not candidate:
        return None
    candidate = os.path.abspath(candidate)
    try:
        link_stat = os.lstat(candidate)
        if stat.S_ISLNK(link_stat.st_mode) or not stat.S_ISREG(link_stat.st_mode):
            return None
        resolved = os.path.realpath(candidate)
        resolved_stat = os.stat(resolved)
        if not stat.S_ISREG(resolved_stat.st_mode) or not os.access(resolved, os.X_OK):
            return None
        return resolved
    except OSError:
        return None


def _agy_probe_tools():
    executable = _verified_executable("agy")
    sandbox = _verified_executable("bwrap")
    if not executable:
        return None, "agy executable is unavailable"
    if not sandbox:
        return None, "read-only AGY probe sandbox (bwrap) is unavailable"
    return (executable, sandbox), None


def _run_agy_command(args, repo_root, timeout=15, read_only=False, session_home=None, share_network=False):
    if not read_only:
        return None, "AGY probes must run in the read-only sandbox"
    tools, unavailable_reason = _agy_probe_tools()
    if unavailable_reason:
        return None, unavailable_reason
    executable, sandbox = tools

    # Never bind the host root or the caller's home into a probe.  A
    # command-capable AGY agent must not be able to reach Docker, DBus, SSH
    # agents, credentials, or another user's files even though the package
    # itself is mounted read-only.  The executable is mounted at a stable path
    # and only standard runtime libraries plus the package under validation are
    # visible.  --unshare-all also isolates PID/IPC/UTS/cgroup/network; the
    # explicit user namespace and capability drop prevent namespace escape via
    # a privileged probe process.
    package_root = _agy_package_root(repo_root)
    command = [
        sandbox, "--unshare-user", "--unshare-all",
    ]
    if share_network:
        command.append("--share-net")
    command.extend([
        "--disable-userns", "--cap-drop", "ALL",
        "--die-with-parent", "--clearenv",
        "--setenv", "PATH", "/workspace/bin:/usr/bin:/bin",
        "--setenv", "HOME", "/home/agy",
        "--setenv", "LANG", "C",
        "--setenv", "LC_ALL", "C",
        "--setenv", "TMPDIR", "/tmp",
        "--setenv", "XDG_CONFIG_HOME", "/home/agy/.config",
        "--setenv", "XDG_CACHE_HOME", "/tmp/cache",
        "--setenv", "XDG_STATE_HOME", "/tmp/state",
        "--dir", "/workspace",
        "--dir", "/workspace/bin",
        "--ro-bind", os.path.realpath(executable), "/workspace/bin/agy",
        "--ro-bind-try", "/usr", "/usr",
        "--ro-bind-try", "/bin", "/bin",
        "--ro-bind-try", "/lib", "/lib",
        "--ro-bind-try", "/lib64", "/lib64",
        "--dir", "/home",
        "--dir", "/home/agy",
        "--dir", "/home/agy/.config",
        "--dir", "/home/agy/.gemini",
        "--dir", "/home/agy/.gemini/antigravity-cli",
        "--dir", "/home/agy/.gemini/config",
        "--dir", "/home/agy/.gemini/config/plugins",
        "--tmpfs", "/tmp",
        "--tmpfs", "/run",
        "--tmpfs", "/etc",
        # Keep /etc masked while projecting only the resolver and public CA
        # bundle required by the shared-network AGY runtime. Private keys and
        # unrelated host configuration remain outside the namespace.
        "--dir", "/etc/ssl",
        "--dir", "/etc/ssl/certs",
        "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
        "--ro-bind-try", "/etc/ssl/certs/ca-certificates.crt", "/etc/ssl/certs/ca-certificates.crt",
        "--ro-bind-try", "/etc/passwd", "/etc/passwd",
        "--ro-bind-try", "/etc/group", "/etc/group",
        "--ro-bind-try", "/etc/nsswitch.conf", "/etc/nsswitch.conf",
        "--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache",
        "--proc", "/proc",
        "--dev", "/dev",
        "--chdir", "/workspace",
        "/workspace/bin/agy",
    ])
    if session_home:
        for relative in AGY_SESSION_ALLOWLIST:
            source = os.path.join(session_home, relative)
            if os.path.isfile(source) and not os.path.islink(source):
                target = os.path.join("/home/agy", relative)
                insert_at = command.index("--tmpfs")
                command[insert_at:insert_at] = ["--ro-bind", source, target]
    if os.path.isdir(package_root) and not os.path.islink(package_root):
        # Mount the structurally validated package at the documented consumer
        # path. AGY discovers native plugins from ~/.gemini/config/plugins/<name>,
        # not from a workspace copy, and `agy plugins list` only reports imports.
        insert_at = command.index("/home/agy/.gemini/config/plugins") + 1
        command[insert_at:insert_at] = [
            "--ro-bind", os.path.realpath(package_root), "/home/agy/.gemini/config/plugins/dhpk",
        ]
    command += list(args)
    try:
        result = subprocess.run(
            command, cwd=repo_root, env={}, capture_output=True, text=True,
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "agy command unavailable: %s" % exc
    output = (result.stdout or "") + (result.stderr or "")
    output_bytes = output.encode("utf-8", "replace")
    if len(output_bytes) > AGY_MAX_OUTPUT_BYTES:
        marker = (AGY_OUTPUT_LIMIT_MARKER + "\n").encode("utf-8")
        tail_size = max(0, AGY_MAX_OUTPUT_BYTES - len(marker))
        output = (marker + output_bytes[-tail_size:]).decode("utf-8", "replace")
    return result.returncode, output


def _agy_plugins_list_native_status(output):
    """Interpret `agy plugins list` without treating import records as native discovery.

    Current AGY CLIs list imported Claude/Antigravity plugins only. An
    import-only payload, including `{"imports":[...]}` or "No imported plugins.",
    is not evidence that the receipt-owned native package was loaded. Return
    None in that case so the caller can defer to isolated `agy agents`.
    """
    text = (output or "").strip()
    if not text:
        return ROW_FAIL, "agy plugins list produced no output"
    lowered = text.lower()
    if lowered == "no imported plugins." or lowered.startswith("no imported plugins"):
        return None, "agy plugins list reports imports only; native plugins are discovered via agy agents"
    try:
        payload = json.loads(text)
    except ValueError:
        if "dhpk" in text:
            return ROW_PASS, None
        return ROW_FAIL, "agy plugins list did not report the dhpk plugin"
    if isinstance(payload, dict) and set(payload.keys()) <= {"imports"}:
        return None, "agy plugins list reports imports only; native plugins are discovered via agy agents"
    native = json.dumps({key: value for key, value in payload.items() if key != "imports"}) if isinstance(payload, dict) else text
    if "dhpk" in native:
        return ROW_PASS, None
    return ROW_FAIL, "agy plugins list did not report the dhpk plugin"


def _agy_discovery_probe(repo_root, package_root, agents):
    notes = []
    plugin_status = ROW_UNAVAILABLE
    agent_status = ROW_UNAVAILABLE
    plugin_code, plugin_output = _run_agy_command(["plugins", "list"], repo_root, read_only=True)
    agent_code, agent_output = _run_agy_command(["agents"], repo_root, read_only=True)
    if plugin_code is None or agent_code is None:
        reason = plugin_output if plugin_code is None else agent_output
        notes.append(reason)
    else:
        agents_found = agent_code == 0 and any(agent[:-3] in agent_output for agent in agents)
        agent_status = ROW_PASS if agents_found else ROW_FAIL
        plugin_status, plugin_note = _agy_plugins_list_native_status(plugin_output if plugin_code == 0 else "")
        if plugin_note:
            notes.append(plugin_note)
        if plugin_status is None:
            # Import-only listing cannot prove native discovery. Isolated
            # `agy agents` is the native load signal. Empty isolated agents on
            # a structurally valid package is the AGY CLI's missing native
            # filesystem loader, not a package-shape FAIL.
            if agents_found:
                plugin_status = ROW_PASS
            else:
                plugin_status = ROW_SKIP_INCOMPATIBLE
                agent_status = ROW_SKIP_INCOMPATIBLE
                notes.append(
                    "AGY CLI has no native filesystem plugin loader; "
                    "isolated empty agents are SKIP_INCOMPATIBLE, not package FAIL"
                )
        if plugin_code != 0 and plugin_status not in (ROW_PASS, ROW_SKIP_INCOMPATIBLE):
            plugin_status = ROW_FAIL
            notes.append("agy plugins list did not report the dhpk plugin")
        if agent_status == ROW_FAIL:
            notes.append("agy agents did not report an inventory-derived agent")
    return plugin_status, agent_status, notes


def _agy_runtime_probe(repo_root, return_details=False):
    _, unavailable_reason = _agy_probe_tools()
    if unavailable_reason:
        result = (ROW_UNAVAILABLE, unavailable_reason, _agy_runtime_details([], _agy_reason_code(ROW_UNAVAILABLE, unavailable_reason)))
        return result if return_details else result[:2]
    host_home = os.environ.get("DHPK_AGY_HOST_HOME")
    session_home, copied = _agy_clone_session(host_home)
    if not copied:
        if session_home:
            shutil.rmtree(session_home, ignore_errors=True)
        result = (ROW_BLOCKED, "agy Subagent probe requires an allowlisted logged-in session", _agy_runtime_details([], "SESSION_UNAVAILABLE"))
        return result if return_details else result[:2]
    try:
        code, output = _run_agy_command([
            "--mode", "plan",
            "--agent", "agy-fast-worker", "--print",
            "Read-only smoke check. Return exactly AGY_SMOKE_OK and do not modify files. Do not call tools.",
            "--output-format", "text",
        ], repo_root, timeout=30, read_only=True, session_home=session_home, share_network=True)
    finally:
        shutil.rmtree(session_home, ignore_errors=True)
    if code is None:
        reason_code = _agy_reason_code(ROW_UNAVAILABLE, output)
        result = (ROW_UNAVAILABLE, _agy_redact_diagnostic(output, reason_code), _agy_runtime_details(copied, reason_code, output))
        return result if return_details else result[:2]
    if code != 0:
        lowered = (output or "").lower()
        if any(marker in lowered for marker in ("authentication", "unauthorized", "api key", "credential", "login")):
            result = (ROW_BLOCKED, "agy Subagent probe requires authentication; use an already-logged-in session", _agy_runtime_details(copied, "AUTH_REQUIRED", output))
            return result if return_details else result[:2]
        if any(marker in lowered for marker in ("network", "connection", "timed out", "timeout", "permission denied", "dns", "resolve")):
            result = (ROW_UNAVAILABLE, "agy Subagent probe is unavailable in the isolated runtime (credentials or connectivity are not available)", _agy_runtime_details(copied, _agy_reason_code(ROW_UNAVAILABLE, output), output))
            return result if return_details else result[:2]
        if any(marker in lowered for marker in ("unknown argument", "unknown command", "flag provided but not defined")):
            result = (ROW_SKIP_INCOMPATIBLE, "agy CLI does not support the bounded --agent/--print runtime route", _agy_runtime_details(copied, "CLI_INCOMPATIBLE", output))
            return result if return_details else result[:2]
        result = (ROW_FAIL, "agy Subagent probe exited with status %s" % code, _agy_runtime_details(copied, "PROBE_FAILED", output))
        return result if return_details else result[:2]
    if output.strip() != "AGY_SMOKE_OK":
        limited = AGY_OUTPUT_LIMIT_MARKER in (output or "")
        reason = "agy Subagent probe output exceeded the bounded diagnostic limit" if limited else "agy Subagent probe did not return the exact AGY_SMOKE_OK marker"
        result = (ROW_FAIL, reason, _agy_runtime_details(copied, "OUTPUT_LIMIT" if limited else "PROBE_FAILED", output))
        return result if return_details else result[:2]
    result = (ROW_PASS, "bounded read-only Subagent probe returned AGY_SMOKE_OK", _agy_runtime_details(copied, "READY"))
    return result if return_details else result[:2]


def validate_agy(repo_root, membership=None, runtime_probe=False):
    package_root = _agy_package_root(repo_root)
    if membership is not None and not membership.get("present"):
        requested = membership.get("requested")
        status = ROW_BLOCKED if requested else ROW_NOT_CONFIGURED
        reason = "找不到 plugins/dhpk-agy/plugin.json 或 .gemini/config/plugins/dhpk/plugin.json（%s）" % (
            "已明確以 --targets/--all-targets 指定" if requested else "未設定，屬 not-configured"
        )
        return not_participating_row("agy", status, reason)

    notes = []
    structural_ok, structural_errors, agents = _validate_agy_package_structure(package_root)
    notes.extend(structural_errors)
    if not structural_ok:
        row = result_row("agy", False, False, ROW_FAIL, ROW_FAIL, notes)
        row["capabilities"] = [
            {"id": "agy.package.structure", "status": ROW_FAIL, "fallback": "none", "reason": "inventory-owned AGY package"},
            {"id": "agy.discovery.plugins", "status": ROW_NOT_RUN, "fallback": "package-structure", "reason": "package structure failed", "reason_code": "PACKAGE_INVALID"},
            {"id": "agy.discovery.agents", "status": ROW_NOT_RUN, "fallback": "package-structure", "reason": "package structure failed", "reason_code": "PACKAGE_INVALID"},
            {"id": "agy.runtime.subagent", "status": ROW_NOT_RUN, "fallback": "NOT_RUN", "reason": "package structure failed", "reason_code": "PACKAGE_INVALID", "session_files": [], "session_file_count": 0},
        ]
        return row

    plugin_status, agent_status, discovery_notes = _agy_discovery_probe(repo_root, package_root, agents)
    notes.extend(discovery_notes)
    runtime_status = ROW_NOT_RUN
    runtime_reason = "runtime Subagent invocation was not requested"
    runtime_details = _agy_runtime_details([], "PROBE_NOT_RUN")
    if runtime_probe:
        runtime_status, runtime_reason, runtime_details = _agy_runtime_probe(repo_root, return_details=True)
        notes.append(runtime_reason)
    hook_state = plugin_status
    multi_state = agent_status
    row = result_row("agy", True, bool(agents), hook_state, multi_state, notes,
                     hook_reason="agy plugins list discovery", multi_reason="agy agents discovery")
    row["capabilities"] = [
        {"id": "agy.package.structure", "status": ROW_PASS if structural_ok else ROW_FAIL, "fallback": "none", "reason": "inventory-owned AGY package", "reason_code": "READY" if structural_ok else "PACKAGE_INVALID"},
        {"id": "agy.discovery.plugins", "status": plugin_status, "fallback": "package-structure", "reason": "agy plugins list", "reason_code": _agy_reason_code(plugin_status, "agy plugins list")},
        {"id": "agy.discovery.agents", "status": agent_status, "fallback": "package-structure", "reason": "agy agents", "reason_code": _agy_reason_code(agent_status, "agy agents")},
        {"id": "agy.runtime.subagent", "status": runtime_status, "fallback": "NOT_RUN", "reason": runtime_reason, "reason_code": runtime_details.get("reason_code", _agy_reason_code(runtime_status, runtime_reason)), **runtime_details},
    ]
    if runtime_status == ROW_FAIL:
        row["final_status"] = ROW_FAIL
    elif runtime_status == ROW_BLOCKED and row["final_status"] == ROW_PASS:
        row["final_status"] = ROW_BLOCKED
    elif runtime_status == ROW_UNAVAILABLE and row["final_status"] == ROW_PASS:
        row["final_status"] = ROW_UNAVAILABLE
    return row


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
    project_local_receipt = os.path.join(repo_root, ".cursor", ".dhpk-installed.json")
    project_local_present = os.path.lexists(project_local_receipt)
    project_local_valid = True
    project_local_reason = "Cursor project-local receipt is not configured"
    if project_local_present:
        project_local_valid, project_local_reason = validate_cursor_project_local(repo_root)
        if not project_local_valid:
            notes.append(project_local_reason)
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
    configured_surface = portable is not None or native is not None or project_local_present
    config_ok = configured_surface and portable_valid and native_valid and project_local_valid
    if not config_ok:
        if not configured_surface:
            notes.append("Cursor configuration marker is present but no supported surface was found")
        elif not project_local_present and portable is None and native is None:
            notes.append("Cursor package marker is present in configuration but no package root was found")

    portable_skills = bool(portable and glob.glob(os.path.join(portable, "skills", "*/SKILL.md")))
    portable_mcp = bool(portable and safe_exists(os.path.join(portable, "mcp.json")))
    smoke_ok = project_local_valid if project_local_present else False
    smoke_ok = smoke_ok or portable_skills or bool(native and glob.glob(os.path.join(native, "skills", "*/SKILL.md")))
    if not smoke_ok:
        notes.append("Cursor configured surfaces have no validated project-local projection or discovered package skills")
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
    project_local_status = ROW_FAIL if project_local_present and not project_local_valid else (ROW_PASS if project_local_present else ROW_NOT_CONFIGURED)
    runtime_reason = "Cursor launch/runtime probe was not run; structural evidence is not runtime proof"
    row["capabilities"] = [
        {"id": "cursor.project_local.structure", "status": project_local_status, "fallback": "package-routes", "reason": project_local_reason},
        {"id": "cursor.portable.skills", "status": portable_status, "fallback": "agent-plugin", "reason": "portable Agent Skills package"},
        {"id": "cursor.portable.mcp", "status": mcp_status, "fallback": "no-mcp-json", "reason": "optional MCP is independently configured"},
        {"id": "cursor.native.rules", "status": native_status if native and safe_exists(os.path.join(native, "rules")) else ROW_SKIP_INCOMPATIBLE, "fallback": "portable-skills", "reason": "Cursor rules"},
        {"id": "cursor.native.agents", "status": ROW_UNAVAILABLE if native_unavailable else (ROW_PASS if native and cursor_agent_roles(repo_root) else ROW_SKIP_INCOMPATIBLE), "fallback": "portable-skills", "reason": "Cursor agents"},
        {"id": "cursor.native.commands", "status": native_status if native and safe_exists(os.path.join(native, "commands")) else ROW_SKIP_INCOMPATIBLE, "fallback": "portable-skills", "reason": "Cursor commands"},
        {"id": "cursor.native.hooks", "status": hook_state, "fallback": "SKIP_INCOMPATIBLE", "reason": hook_reason},
        {"id": "cursor.native.variables", "status": ROW_UNAVAILABLE if native_unavailable else (ROW_PASS if native and safe_exists(os.path.join(native, ".cursor-plugin", "plugin.json")) else ROW_SKIP_INCOMPATIBLE), "fallback": "no-client-variables", "reason": "Cursor variables schema"},
        {"id": "cursor.runtime.launch", "status": ROW_NOT_RUN, "fallback": "launch-probe-required", "reason": runtime_reason},
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
    # Claude parity role to sync (design.md Decision 4 / harness-govern provenance).
    parity_roles = claude_parity_roles(repo_root)
    manifest = load_agent_sync_manifest(repo_root)
    manifest_issues = []
    coverage_issues = []
    manifest_required = codex_present and bool(parity_roles)

    # Task 4.3: which agent-ownership contract this Codex target selected, and
    # the evidence used to select it (harness-govern sync provenance spec).
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


def run_validation(repo_root, change_id=None, targets=None, all_targets=False, agy_runtime_probe=False):
    membership = resolve_target_membership(repo_root, targets=targets, all_targets=all_targets)

    rows = [validate_claude(repo_root)]
    validators = {"codex": validate_codex, "antigravity": validate_antigravity, "agy": lambda root, entry: validate_agy(root, entry, runtime_probe=agy_runtime_probe), "cursor": validate_cursor}
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
