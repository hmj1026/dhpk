"""Post-sync validation 與報告輸出。"""

import glob
import os

from .constants import CHECK_FAIL, CHECK_PASS, CHECK_SKIP
from .sources import gemini_hook_surface_enabled
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
        CHECK_PASS: "OK",
        CHECK_FAIL: "FAIL",
        CHECK_SKIP: "SKIP",
    }.get(state, "FAIL")


def final_status_from_checks(config_ok, smoke_ok, hook_state, multi_state):
    if not config_ok or not smoke_ok:
        return "FAIL"
    representative = [hook_state, multi_state]
    if CHECK_FAIL in representative:
        return "FAIL"
    if CHECK_SKIP in representative:
        return "PARTIAL"
    return "PASS"


def result_row(platform, config_ok, smoke_ok, hook_state, multi_state, notes):
    final = final_status_from_checks(config_ok, smoke_ok, hook_state, multi_state)
    return {
        "platform": platform,
        "config_load_ok": config_ok,
        "smoke_ok": smoke_ok,
        "hook_case_state": hook_state,
        "multi_agent_case_state": multi_state,
        "hook_case_ok": hook_state == CHECK_PASS,
        "multi_agent_case_ok": multi_state == CHECK_PASS,
        "final_status": final,
        "notes": notes,
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
    if os.path.isdir(hook_dir):
        hook_state = CHECK_PASS if has_any_files(hook_dir) else CHECK_FAIL
        if hook_state == CHECK_FAIL:
            notes.append(".claude/hooks 存在，但找不到 hook 檔案")
    else:
        hook_state = CHECK_SKIP
        notes.append("沒有 .claude/hooks 目錄；代表性 hook 檢查標記為 skip")

    multi_state = CHECK_PASS if bool(glob.glob(os.path.join(repo_root, ".claude/agents/*.md"))) else CHECK_FAIL
    if multi_state == CHECK_FAIL:
        notes.append("找不到 .claude/agents/*.md")

    return result_row("claude", config_ok, smoke_ok, hook_state, multi_state, notes)


def check_codex_agent_role_fields(agents_dir):
    """Return a list of failure strings for any *.toml role file in agents_dir
    missing a non-empty name / description / developer_instructions."""
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


def validate_codex(repo_root):
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

    hook_state = CHECK_SKIP
    notes.append("Codex project 的 hook mapping 不支援；視為 skip-incompatible")

    multi_state = CHECK_PASS if (config_ok and bool(glob.glob(os.path.join(repo_root, ".codex/agents/*.toml")))) else CHECK_FAIL
    if multi_state == CHECK_FAIL:
        notes.append("Codex multi-agent 代表性檢查失敗")

    role_failures = check_codex_agent_role_fields(os.path.join(repo_root, ".codex", "agents"))
    if role_failures:
        notes.extend(role_failures)
        notes.append("Codex agent role 檔案缺少必要欄位: %d 個" % len(role_failures))
        multi_state = CHECK_FAIL

    return result_row("codex", config_ok, smoke_ok, hook_state, multi_state, notes)


def validate_gemini(repo_root):
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

    if gemini_hook_surface_enabled(repo_root):
        hook_root = os.path.join(repo_root, ".gemini/hooks")
        ext_root = os.path.join(repo_root, ".gemini/extensions")
        has_hook_files = has_any_files(hook_root) if os.path.isdir(hook_root) else False
        has_extension_files = has_any_files(ext_root) if os.path.isdir(ext_root) else False
        hook_state = CHECK_PASS if (has_hook_files or has_extension_files) else CHECK_FAIL
        if hook_state == CHECK_FAIL:
            notes.append("Gemini hook surface 已啟用，但找不到代表性 hook artifacts")
    else:
        hook_state = CHECK_SKIP
        notes.append("Gemini hook parity 屬 repository-specific；目前視為 skip-incompatible")

    multi_state = CHECK_SKIP
    notes.append("此 repository 佈局不提供 Gemini multi-agent parity；標記為 skip-incompatible")

    return result_row("gemini", config_ok, smoke_ok, hook_state, multi_state, notes)


def validate_antigravity(repo_root):
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

    hook_state = CHECK_SKIP
    notes.append("Antigravity hook parity 不支援；視為 skip-incompatible")

    multi_state = CHECK_PASS if safe_exists(os.path.join(repo_root, ".agent/workflows/review.md")) else CHECK_FAIL
    if multi_state == CHECK_FAIL:
        notes.append("缺少 .agent/workflows/review.md（代表性 multi-agent workflow）")

    return result_row("antigravity", config_ok, smoke_ok, hook_state, multi_state, notes)


def run_policy_checks(repo_root):
    """Task 5: 執行三類政策型檢查（path canonicalization、profile compatibility、agent parity）。"""
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
    parity_agents = {
        "tdd-guide-<your-project>": ["PHPUnit 5.7", "strcasecmp", "assertInternalType"],
        "code-reviewer-<your-project>": ["Yii 1.1", "PHP 5.6"],
        "database-reviewer-<your-project>": ["queryRow", "PDO", "MySQL 5.7"],
        "security-reviewer-<your-project>": ["accessRules", "CSRF", "Yii"],
        "bug-investigator": ["root cause", "data-flow"],
    }
    parity_issues = []
    for agent_name, keywords in parity_agents.items():
        toml_path = os.path.join(repo_root, ".codex", "agents", "%s.toml" % agent_name)
        if not safe_exists(toml_path):
            parity_issues.append("%s.toml 不存在" % agent_name)
            continue
        content = read_text(toml_path)
        missing = [kw for kw in keywords if kw not in content]
        if missing:
            parity_issues.append("%s 缺少關鍵字: %s" % (agent_name, ", ".join(missing)))

    if not parity_issues:
        checks.append({"id": "parity.agents", "level": "warn", "status": CHECK_PASS,
                       "message": "Codex agents 關鍵約束覆蓋完整。"})
    else:
        checks.append({"id": "parity.agents", "level": "warn", "status": CHECK_FAIL,
                       "message": "Agent parity 不完整: %s" % "; ".join(parity_issues)})

    return checks


def run_validation(repo_root, change_id=None):
    rows = [
        validate_claude(repo_root),
        validate_codex(repo_root),
        validate_gemini(repo_root),
        validate_antigravity(repo_root),
    ]
    gate = "PASS"
    for row in rows:
        if row["final_status"] == "FAIL":
            gate = "FAIL"
            break
        if row["final_status"] == "PARTIAL" and gate != "FAIL":
            gate = "PARTIAL"

    # Task 5: 政策型檢查
    policy_checks = run_policy_checks(repo_root)
    for check in policy_checks:
        if check["status"] == CHECK_FAIL and check["level"] == "fail":
            # FAIL level policy：升級 gate 為 FAIL
            if gate != "FAIL":
                gate = "FAIL"
        elif check["status"] == CHECK_FAIL and check["level"] == "warn":
            # WARN level policy：降級 gate 為 PARTIAL（若原為 PASS）
            if gate == "PASS":
                gate = "PARTIAL"

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
    lines.append("- `PASS`: Config+Smoke 都 OK，且代表案例（Hooks/Multi-Agent）皆非 FAIL/SKIP。")
    lines.append("- `PARTIAL`: Config+Smoke 都 OK，但代表案例至少一項為 SKIP（通常是 skip-incompatible）。")
    lines.append("- `FAIL`: 任一平台 Config 或 Smoke 為 FAIL，或代表案例出現 FAIL。")
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
    return "\n".join(lines)
