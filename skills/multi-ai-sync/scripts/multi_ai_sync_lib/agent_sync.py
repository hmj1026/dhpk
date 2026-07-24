"""Claude->Codex agent parity helpers."""

import glob
import json
import os
import re

from .utils import now_iso, read_text, relpath, safe_exists, uniq

try:
    import tomllib
except Exception:  # pragma: no cover - py3.10 fallback
    tomllib = None
    try:
        import tomli as tomllib  # type: ignore
    except Exception:
        tomllib = None


CLAUDE_PARITY_COVERAGE_KEYWORDS = {
    "architect-<your-project>": ["Controller", "Domain", "Infrastructure"],
    "code-reviewer-<your-project>": ["CRITICAL", "HIGH", "SQL injection"],
    "database-reviewer-<your-project>": ["transaction", "N+1"],
    "refactor-cleaner-<your-project>": ["dead", "duplicate"],
    "security-reviewer-<your-project>": ["CSRF", "XSS", "SQL"],
    "tdd-guide-<your-project>": ["RED", "GREEN", "REFACTOR"],
}

CODEX_NATIVE_AGENTS = ["bug-investigator", "explorer", "monitor", "worker"]

SYNC_MANIFEST_PATH = ".codex/agents/sync-manifest.json"
MIRROR_ROOT = ".codex/agents/references/claude"

PATH_TOKEN_RE = re.compile(
    r"`([^`\n]*(?:~?/\.claude/|\.claude/|references/|[A-Za-z0-9._/\-]+\.(?:md|json|toml|sh))[^`\n]*)`"
)
SIMPLE_TOML_STRING_RE = r'^{key}\s*=\s*"([^"\n]*)"\s*$'


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
        frontmatter[match.group(1).strip()] = match.group(2).strip().strip('"').strip("'")
    return frontmatter, body


def _load_toml(path):
    if tomllib is None:
        raise RuntimeError("沒有可用 TOML parser（tomllib/tomli）")
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def _escape_toml_basic(value):
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _append_toml_multiline(lines, key, value):
    if "'''" in value:
        lines.append('%s = """' % key)
        lines.append(_escape_toml_basic(value).replace('"""', '\\"""'))
        lines.append('"""')
        return
    lines.append("%s = '''" % key)
    lines.append(value)
    lines.append("'''")


def _extract_simple_toml_string(raw_text, key):
    match = re.search(SIMPLE_TOML_STRING_RE.format(key=re.escape(key)), raw_text, re.MULTILINE)
    if not match:
        return ""
    return match.group(1)


def _first_nonempty(*values):
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def claude_parity_roles(repo_root):
    roles = []
    for path in sorted(glob.glob(os.path.join(repo_root, ".claude/agents/*.md"))):
        roles.append(os.path.splitext(os.path.basename(path))[0])
    return roles


def codex_agent_target_rel(role):
    return ".codex/agents/%s.toml" % role


def codex_agent_mirror_rel(role):
    return ".codex/agents/%s.md" % role


def _mirror_ref_rel(source_rel):
    if not source_rel.startswith(".claude/"):
        raise ValueError("unsupported source rel for mirror: %s" % source_rel)
    suffix = source_rel[len(".claude/"):].lstrip("/")
    return "%s/%s" % (MIRROR_ROOT, suffix)


def _load_target_metadata(repo_root, role):
    defaults = {
        "name": role,
        "description": "Claude parity role synced from .claude/agents/%s.md" % role,
        "model": "gpt-5.3-codex",
        "model_reasoning_effort": "medium",
    }
    path = os.path.join(repo_root, codex_agent_target_rel(role))
    if not safe_exists(path):
        return defaults
    try:
        payload = _load_toml(path)
        return {
            "name": _first_nonempty(payload.get("name"), defaults["name"]),
            "description": _first_nonempty(payload.get("description"), defaults["description"]),
            "model": _first_nonempty(payload.get("model"), defaults["model"]),
            "model_reasoning_effort": _first_nonempty(
                payload.get("model_reasoning_effort"), defaults["model_reasoning_effort"]
            ),
        }
    except Exception:
        raw_text = read_text(path)
        return {
            "name": _extract_simple_toml_string(raw_text, "name") or defaults["name"],
            "description": _extract_simple_toml_string(raw_text, "description") or defaults["description"],
            "model": _extract_simple_toml_string(raw_text, "model") or defaults["model"],
            "model_reasoning_effort": _extract_simple_toml_string(raw_text, "model_reasoning_effort")
            or defaults["model_reasoning_effort"],
        }


def _extract_backticked_paths(markdown):
    return [item.strip() for item in PATH_TOKEN_RE.findall(markdown) if item.strip()]


def discover_agent_references(repo_root, source_rel):
    source_abs = os.path.join(repo_root, source_rel)
    markdown = read_text(source_abs)
    source_dir = os.path.dirname(source_abs)
    claude_root = os.path.normpath(os.path.join(repo_root, ".claude"))

    repo_refs = []
    nonportable_refs = []
    for token in _extract_backticked_paths(markdown):
        if token.startswith("~/.claude/"):
            nonportable_refs.append(token)
            continue

        if token.startswith(".claude/"):
            target_abs = os.path.join(repo_root, token)
            if safe_exists(target_abs):
                repo_refs.append(token)
            continue

        if "/" not in token and not token.startswith("references/"):
            continue

        candidate_abs = os.path.normpath(os.path.join(source_dir, token))
        if candidate_abs.startswith(claude_root) and safe_exists(candidate_abs):
            repo_refs.append(relpath(candidate_abs, repo_root))

    return {
        "repo_refs": uniq(sorted(repo_refs)),
        "nonportable_refs": uniq(sorted(nonportable_refs)),
    }


def render_codex_agent_toml(role, source_rel, body, target_metadata, mirrored_refs, nonportable_refs, coverage_keywords, sync_run_id):
    lines = []
    lines.append('name = "%s"' % _escape_toml_basic(target_metadata["name"]))
    lines.append('description = "%s"' % _escape_toml_basic(target_metadata["description"]))
    lines.append('model = "%s"' % target_metadata["model"])
    lines.append('model_reasoning_effort = "%s"' % target_metadata["model_reasoning_effort"])
    lines.append("")

    instruction_lines = []
    instruction_lines.append("Role: %s" % role)
    instruction_lines.append("Source agent: %s" % source_rel)
    instruction_lines.append("Mirror agent: %s" % codex_agent_mirror_rel(role))
    instruction_lines.append("Sync run ID: %s" % sync_run_id)
    instruction_lines.append("Sync mode: claude-parity-self-contained")
    instruction_lines.append("Manifest: %s" % SYNC_MANIFEST_PATH)
    instruction_lines.append("This file is self-contained. Do not assume access to external reference files at runtime.")
    instruction_lines.append("")

    instruction_lines.append("Coverage keywords:")
    for keyword in coverage_keywords:
        instruction_lines.append("- %s" % keyword)
    if not coverage_keywords:
        instruction_lines.append("- (none)")
    instruction_lines.append("")

    instruction_lines.append("Mirrored repo references:")
    for path in mirrored_refs:
        instruction_lines.append("- %s" % path)
    if not mirrored_refs:
        instruction_lines.append("- (none)")
    instruction_lines.append("")

    instruction_lines.append("Nonportable Claude sources already inlined here:")
    for path in nonportable_refs:
        instruction_lines.append("- %s" % path)
    if not nonportable_refs:
        instruction_lines.append("- (none)")
    instruction_lines.append("")

    instruction_lines.append("# Synced Claude Content (runtime guidance below)")
    instruction_lines.append("")
    instruction_lines.append(body.rstrip())

    _append_toml_multiline(lines, "developer_instructions", "\n".join(instruction_lines))
    lines.append("")
    return "\n".join(lines)


def build_agent_sync_bundle(repo_root, role, sync_run_id):
    source_rel = ".claude/agents/%s.md" % role
    source_abs = os.path.join(repo_root, source_rel)
    if not safe_exists(source_abs):
        raise RuntimeError("找不到 Claude agent source: %s" % source_rel)

    target_rel = codex_agent_target_rel(role)
    target_abs = os.path.join(repo_root, target_rel)
    if not safe_exists(target_abs):
        raise RuntimeError("找不到 Codex agent target: %s" % target_rel)

    source_markdown = read_text(source_abs)
    frontmatter, body = _split_frontmatter(source_markdown)
    refs = discover_agent_references(repo_root, source_rel)
    mirrored_ref_items = []
    for ref in refs["repo_refs"]:
        mirrored_ref_items.append({
            "source": ref,
            "target": _mirror_ref_rel(ref),
        })

    coverage_keywords = list(CLAUDE_PARITY_COVERAGE_KEYWORDS.get(role, []))
    target_metadata = _load_target_metadata(repo_root, role)
    target_metadata["name"] = _first_nonempty(frontmatter.get("name"), target_metadata["name"], role)
    target_metadata["description"] = _first_nonempty(
        frontmatter.get("description"),
        target_metadata["description"],
        "Claude parity role synced from %s" % source_rel,
    )
    mirrored_targets = [item["target"] for item in mirrored_ref_items]
    draft_toml = render_codex_agent_toml(
        role,
        source_rel,
        body,
        target_metadata,
        mirrored_targets,
        refs["nonportable_refs"],
        coverage_keywords,
        sync_run_id,
    )

    manifest_entry = {
        "source_agent": source_rel,
        "target_toml": target_rel,
        "mirror_md": codex_agent_mirror_rel(role),
        "mirrored_refs": mirrored_targets,
        "nonportable_sources": list(refs["nonportable_refs"]),
        "coverage_keywords": coverage_keywords,
        "sync_run_id": sync_run_id,
    }

    return {
        "role": role,
        "source_agent": source_rel,
        "target_toml": target_rel,
        "mirror_md": codex_agent_mirror_rel(role),
        "mirror_content": source_markdown,
        "mirrored_ref_items": mirrored_ref_items,
        "nonportable_sources": list(refs["nonportable_refs"]),
        "coverage_keywords": coverage_keywords,
        "draft_toml_content": draft_toml,
        "manifest_entry": manifest_entry,
    }


def build_agent_sync_manifest(repo_root, sync_run_id, bundles):
    entries = []
    for bundle in bundles:
        if bundle.get("manifest_entry"):
            entries.append(bundle["manifest_entry"])

    entries = sorted(entries, key=lambda item: item["source_agent"])
    return {
        "generated_at": now_iso(),
        "source": "claude",
        "target": "codex",
        "mode": "claude-parity-self-contained",
        "sync_run_id": sync_run_id,
        "manifest_path": SYNC_MANIFEST_PATH,
        "roles": entries,
        "codex_native_agents": list(CODEX_NATIVE_AGENTS),
    }


def load_agent_sync_manifest(repo_root):
    path = os.path.join(repo_root, SYNC_MANIFEST_PATH)
    if not safe_exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)
