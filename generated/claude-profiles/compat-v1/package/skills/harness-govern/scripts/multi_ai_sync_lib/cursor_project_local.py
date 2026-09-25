"""Fail-closed validation for receipt-owned project-local Cursor projections."""

import hashlib
import json
import os
import re
import stat


RECEIPT_LIMIT = 1024 * 1024
ENTRY_LIMIT = 5000
HASH_ENTRY_LIMIT = 40000
HASH_BYTE_LIMIT = 256 * 1024 * 1024
HASH_DEPTH_LIMIT = 64
REQUIRED_KINDS = ("skills", "agents", "rules", "commands", "supporting_assets")
REQUIRED_NATIVE_KINDS = ("agents", "rules", "commands", "supporting_assets")
SKILL_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256 = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
IGNORED_NAMES = {"__pycache__"}


class CursorProjectLocalError(ValueError):
    pass


def _manifest(path):
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("name") not in ("dhpk", "dhpk-agent"):
        return None
    version = payload.get("version")
    return payload if isinstance(version, str) and version else None


def _current_source():
    current = os.path.abspath(os.path.dirname(__file__))
    for _ in range(14):
        manifest_path = os.path.join(current, ".claude-plugin", "plugin.json")
        source_root = os.path.join(current, "cursor")
        manifest = _manifest(manifest_path)
        if manifest and manifest.get("name") == "dhpk" and os.path.isdir(source_root):
            return current, source_root, manifest.get("version")
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None, None, None


def _safe_relative(value):
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        return False
    normalized = os.path.normpath(value).replace(os.sep, "/")
    return (
        not os.path.isabs(value)
        and normalized == value
        and normalized not in (".", "..")
        and not normalized.startswith("../")
    )


def _contained(path, root):
    try:
        return os.path.commonpath((os.path.abspath(path), os.path.abspath(root))) == os.path.abspath(root)
    except ValueError:
        return False


def _ignored(name):
    return name in IGNORED_NAMES or name.endswith(".pyc")


def _consume(budget, byte_count=0):
    budget["entries"] += 1
    budget["bytes"] += byte_count
    if budget["entries"] > HASH_ENTRY_LIMIT:
        raise CursorProjectLocalError("projection traversal entry limit exceeded")
    if budget["bytes"] > HASH_BYTE_LIMIT:
        raise CursorProjectLocalError("projection traversal byte limit exceeded")


def _hash_path(path, allowed_root, include_ignored, reject_symlinks, budget, depth=0, seen=None):
    if depth > HASH_DEPTH_LIMIT:
        raise CursorProjectLocalError("projection traversal depth limit exceeded")
    path = os.path.abspath(path)
    if not _contained(path, allowed_root):
        raise CursorProjectLocalError("projection path escapes its approved root")
    parent = os.path.dirname(path)
    name = os.path.basename(path)
    parent_fd = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        return _hash_entry(
            parent_fd, parent, name, allowed_root, include_ignored,
            reject_symlinks, budget, depth, seen or set(),
        )
    finally:
        os.close(parent_fd)


def _hash_entry(parent_fd, parent_path, name, allowed_root, include_ignored,
                reject_symlinks, budget, depth, seen):
    if depth > HASH_DEPTH_LIMIT:
        raise CursorProjectLocalError("projection traversal depth limit exceeded")
    if not include_ignored and _ignored(name):
        return ""
    entry_stat = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    _consume(budget)
    if stat.S_ISLNK(entry_stat.st_mode):
        if reject_symlinks:
            raise CursorProjectLocalError("copy projection contains a symlink")
        target = os.readlink(name, dir_fd=parent_fd)
        resolved = os.path.realpath(os.path.join(parent_path, target))
        if not _contained(resolved, allowed_root) or not os.path.exists(resolved):
            raise CursorProjectLocalError("symlink target escapes its approved source root")
        return _hash_path(
            resolved, allowed_root, include_ignored, reject_symlinks,
            budget, depth + 1, seen,
        )
    digest = hashlib.sha256()
    if stat.S_ISREG(entry_stat.st_mode):
        digest.update(b"file\0")
        file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd)
        try:
            while True:
                chunk = os.read(file_fd, 1024 * 1024)
                if not chunk:
                    break
                budget["bytes"] += len(chunk)
                if budget["bytes"] > HASH_BYTE_LIMIT:
                    raise CursorProjectLocalError("projection traversal byte limit exceeded")
                digest.update(chunk)
        finally:
            os.close(file_fd)
        return digest.hexdigest()
    if not stat.S_ISDIR(entry_stat.st_mode):
        raise CursorProjectLocalError("projection contains an unsupported filesystem entry")

    inode = (entry_stat.st_dev, entry_stat.st_ino)
    if inode in seen:
        raise CursorProjectLocalError("projection traversal cycle detected")
    seen.add(inode)
    digest.update(b"dir\0")
    directory_fd = os.open(
        name,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        dir_fd=parent_fd,
    )
    try:
        for child_name in sorted(os.listdir(directory_fd)):
            if not include_ignored and _ignored(child_name):
                continue
            digest.update(child_name.replace(os.sep, "/").encode("utf-8"))
            digest.update(b"\0")
            digest.update(_hash_entry(
                directory_fd,
                os.path.join(parent_path, name),
                child_name,
                allowed_root,
                include_ignored,
                reject_symlinks,
                budget,
                depth + 1,
                seen,
            ).encode("ascii"))
            digest.update(b"\0")
    finally:
        os.close(directory_fd)
        seen.remove(inode)
    return digest.hexdigest()


def _selected_skill_names(plugin_root, receipt):
    inventory_path = os.path.join(plugin_root, "manifests", "distribution-inventory.json")
    try:
        with open(inventory_path, encoding="utf-8") as handle:
            inventory = json.load(handle)
    except (OSError, ValueError):
        raise CursorProjectLocalError("current distribution inventory is unavailable")
    available = {}
    for skill in inventory.get("skills") or []:
        if (not isinstance(skill, dict)
                or "cursor-sync" not in (skill.get("surfaces") or [])
                or skill.get("lifecycle") not in ("promoted", "active")):
            continue
        stable_id = skill.get("id")
        name = skill.get("name")
        if isinstance(stable_id, str) and isinstance(name, str):
            available[stable_id] = name
    emitted = receipt.get("emittedStableIds")
    if emitted is None:
        return sorted(available.values())
    if (not isinstance(emitted, list) or not emitted
            or any(not isinstance(stable_id, str) or stable_id not in available for stable_id in emitted)
            or len(set(emitted)) != len(emitted)):
        raise CursorProjectLocalError("receipt capability selection is invalid or stale")
    selected = receipt.get("selectedStableIds")
    if (not isinstance(selected, list) or any(stable_id not in selected for stable_id in emitted)
            or not isinstance(receipt.get("profileId"), str)
            or receipt.get("compatibilityMode") not in ("profile", "compat-v1", "compatibility")
            or not SHA256.fullmatch(str(receipt.get("selectionFingerprint") or ""))
            or not SHA256.fullmatch(str(receipt.get("surfaceSelectionFingerprint") or ""))):
        raise CursorProjectLocalError("receipt capability selection provenance is incomplete")
    return sorted(available[stable_id] for stable_id in emitted)


DEPENDENCY_GATED_KINDS = ("commands", "agents")
SKILL_REF_RE = re.compile(r"skills/([A-Za-z0-9._-]+)/")


def _skill_token_map(plugin_root):
    inventory_path = os.path.join(plugin_root, "manifests", "distribution-inventory.json")
    try:
        with open(inventory_path, encoding="utf-8") as handle:
            inventory = json.load(handle)
    except (OSError, ValueError):
        raise CursorProjectLocalError("current distribution inventory is unavailable")
    tokens = {}
    for skill in inventory.get("skills") or []:
        if not isinstance(skill, dict):
            continue
        stable_id = skill.get("id")
        if not isinstance(stable_id, str) or not stable_id:
            continue
        tokens[stable_id] = stable_id
        name = skill.get("name")
        if isinstance(name, str) and name:
            tokens[name] = stable_id
        skill_path = skill.get("path")
        if isinstance(skill_path, str) and skill_path:
            tokens[os.path.basename(skill_path.rstrip("/"))] = stable_id
    return tokens


def _available_skill_ids(receipt):
    ids = set()
    for key in ("emittedStableIds", "runtimeSupportStableIds"):
        values = receipt.get(key)
        if not isinstance(values, list):
            continue
        ids.update(value for value in values if isinstance(value, str) and value)
    return ids


def _iter_source_texts(source):
    real = source
    try:
        if os.path.islink(source):
            real = os.path.realpath(source)
    except OSError:
        return
    if os.path.isfile(real):
        try:
            with open(real, encoding="utf-8", errors="ignore") as handle:
                yield handle.read()
        except OSError:
            return
        return
    if not os.path.isdir(real):
        return
    for root, dirs, files in os.walk(real):
        dirs[:] = [name for name in dirs if not _ignored(name)]
        for name in files:
            if _ignored(name):
                continue
            path = os.path.join(root, name)
            try:
                if not os.path.isfile(path):
                    continue
                with open(path, encoding="utf-8", errors="ignore") as handle:
                    yield handle.read()
            except OSError:
                continue


def _unmet_skill_dependency_ids(kind, source, tokens, available_ids):
    if kind not in DEPENDENCY_GATED_KINDS:
        return []
    missing = set()
    for text in _iter_source_texts(source):
        if not isinstance(text, str):
            continue
        for match in SKILL_REF_RE.finditer(text):
            stable_id = tokens.get(match.group(1))
            if stable_id and stable_id not in available_ids:
                missing.add(stable_id)
    return sorted(missing)


def _expected_entries(plugin_root, source_root, receipt):
    expected = {}
    tokens = _skill_token_map(plugin_root)
    available_ids = _available_skill_ids(receipt)
    filter_gated = receipt.get("emittedStableIds") is not None
    for kind in REQUIRED_KINDS[:-1]:
        kind_root = os.path.join(source_root, kind)
        if not os.path.isdir(kind_root):
            raise CursorProjectLocalError("current Cursor source is missing %s" % kind)
        names = _selected_skill_names(plugin_root, receipt) if kind == "skills" else sorted(os.listdir(kind_root))
        expected[kind] = {}
        for name in names:
            if _ignored(name):
                continue
            path = os.path.join(kind_root, name)
            if not os.path.lexists(path):
                continue
            if filter_gated and _unmet_skill_dependency_ids(kind, path, tokens, available_ids):
                continue
            expected[kind][name] = path

    supporting_root = os.path.join(source_root, "dhpk")
    supporting = {}
    if os.path.isdir(supporting_root):
        for directory, directory_names, file_names in os.walk(supporting_root, followlinks=False):
            directory_names[:] = sorted(name for name in directory_names if not _ignored(name))
            for name in sorted(file_names):
                if _ignored(name):
                    continue
                path = os.path.join(directory, name)
                relative = os.path.relpath(path, source_root).replace(os.sep, "/")
                supporting[relative] = path
    expected["supporting_assets"] = supporting
    if any(not values for values in expected.values()):
        raise CursorProjectLocalError("current Cursor source has an incomplete managed surface")
    if sum(len(values) for values in expected.values()) > ENTRY_LIMIT:
        raise CursorProjectLocalError("current Cursor source exceeds the managed entry limit")
    return expected


def _symlink_source(managed, plugin_version):
    source_root = None
    for kind in REQUIRED_NATIVE_KINDS:
        for entry in (managed.get(kind) or {}).values():
            if not isinstance(entry, dict):
                continue
            destination = entry.get("destination")
            target = entry.get("destination_target")
            if not _safe_relative(destination) or not isinstance(target, str) or not os.path.isabs(target):
                raise CursorProjectLocalError("symlink receipt has an unsafe source target")
            normalized_target = os.path.normpath(target)
            candidate_root = normalized_target
            for _ in destination.split("/"):
                candidate_root = os.path.dirname(candidate_root)
            if source_root is None:
                source_root = candidate_root
            if candidate_root != source_root:
                raise CursorProjectLocalError("symlink receipt has inconsistent source roots")
            expected_target = os.path.join(source_root, *destination.split("/"))
            if normalized_target != expected_target:
                raise CursorProjectLocalError("symlink target escapes its approved source root")
    if not source_root or os.path.basename(source_root) != "cursor":
        raise CursorProjectLocalError("symlink receipt has no approved Cursor source root")
    plugin_root = os.path.dirname(source_root)
    manifest = _manifest(os.path.join(plugin_root, ".claude-plugin", "plugin.json"))
    if (not manifest or manifest.get("name") != "dhpk"
            or manifest.get("version") != plugin_version
            or os.path.realpath(plugin_root) != os.path.abspath(plugin_root)):
        raise CursorProjectLocalError("symlink source root is not owned by the recorded dhpk version")
    return source_root, plugin_root


def _symlinked_ancestor(path, root):
    current = os.path.abspath(path)
    stop = os.path.abspath(root)
    while True:
        try:
            if stat.S_ISLNK(os.lstat(current).st_mode):
                return current
        except OSError:
            pass
        if current == stop:
            return None
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def _inside_real_root(candidate, root):
    try:
        real_candidate = os.path.realpath(candidate)
        real_root = os.path.realpath(root)
        return os.path.commonpath((real_candidate, real_root)) == real_root
    except (OSError, ValueError):
        return False


def _leftover_native_skill_directories(cursor_root, required=True):
    skills_root = os.path.join(cursor_root, "skills")
    try:
        root_stat = os.lstat(skills_root)
    except OSError:
        if not required:
            return None, []
        return "Cursor skills root is missing", []
    if stat.S_ISLNK(root_stat.st_mode) or not stat.S_ISDIR(root_stat.st_mode):
        return "Cursor skills root is a symlink or not a directory", []
    leftovers = []
    try:
        names = os.listdir(skills_root)
    except OSError:
        return "Cursor skills root is unreadable", leftovers
    for name in sorted(names):
        if _ignored(name):
            continue
        path = os.path.join(skills_root, name)
        try:
            entry_stat = os.lstat(path)
        except OSError:
            continue
        if stat.S_ISDIR(entry_stat.st_mode) and not stat.S_ISLNK(entry_stat.st_mode):
            leftovers.append(name)
    return None, leftovers


def _skill_id_by_name(plugin_root, receipt):
    names = _selected_skill_names(plugin_root, receipt)
    inventory_path = os.path.join(plugin_root, "manifests", "distribution-inventory.json")
    try:
        with open(inventory_path, encoding="utf-8") as handle:
            inventory = json.load(handle)
    except (OSError, ValueError):
        raise CursorProjectLocalError("current distribution inventory is unavailable")
    ids = {}
    for skill in inventory.get("skills") or []:
        if (not isinstance(skill, dict)
                or "cursor-sync" not in (skill.get("surfaces") or [])
                or skill.get("lifecycle") not in ("promoted", "active")):
            continue
        stable_id = skill.get("id")
        name = skill.get("name")
        if isinstance(stable_id, str) and isinstance(name, str) and name in names:
            ids[name] = stable_id
    return ids


def _validate_cursor_native_links(repo_root, plugin_root, expected_skills, skill_ids, budget):
    errors = []
    hashed = []
    for relative in (".agents", os.path.join(".agents", "skills"), os.path.join(".cursor", "skills")):
        linked = _symlinked_ancestor(os.path.join(repo_root, relative), repo_root)
        if linked:
            errors.append("Cursor native-link ancestor is a symlink: %s" % relative)
            break
    projection_path = os.path.join(repo_root, ".agents", ".dhpk-installed.json")
    try:
        projection_stat = os.lstat(projection_path)
        if not stat.S_ISREG(projection_stat.st_mode) or stat.S_ISLNK(projection_stat.st_mode):
            return errors + ["Cursor shared projection receipt is not a regular file"], hashed
        if projection_stat.st_size > RECEIPT_LIMIT:
            return errors + ["Cursor shared projection receipt exceeds the 1 MiB validation limit"], hashed
        with open(projection_path, encoding="utf-8") as handle:
            projection = json.load(handle)
    except ValueError:
        return errors + ["Cursor shared projection receipt is invalid JSON"], hashed
    except OSError:
        return errors + ["Cursor shared projection receipt is unreadable"], hashed
    if not isinstance(projection, dict):
        return errors + ["Cursor shared projection receipt must be a JSON object"], hashed
    host_bindings = projection.get("hostBindings")
    cursor_host = host_bindings.get("cursor") if isinstance(host_bindings, dict) else None
    if not isinstance(cursor_host, dict) or cursor_host.get("bindingShape") not in ("native-link", "direct"):
        return errors + ["Cursor shared projection is missing native-link Host Bindings"], hashed
    shape = cursor_host.get("bindingShape")
    leftover_reason, leftovers = _leftover_native_skill_directories(
        os.path.join(repo_root, ".cursor"),
        required=shape != "direct",
    )
    if leftover_reason:
        errors.append(leftover_reason)
    if leftovers:
        errors.append("leftover native skill copies: %s" % ", ".join(leftovers[:10]))
    bindings = cursor_host.get("bindings")
    if not isinstance(bindings, list) or not bindings:
        return errors + ["Cursor shared projection has no %s skill bindings" % shape], hashed
    bound_names = {}
    for binding in bindings:
        if not isinstance(binding, dict) or binding.get("shape") != shape:
            errors.append("Cursor %s binding is malformed" % shape)
            continue
        if shape == "direct":
            name = binding.get("name")
            if not isinstance(name, str) or binding.get("path") or binding.get("target") or not SKILL_NAME.fullmatch(name):
                errors.append("Cursor direct binding is malformed" if not isinstance(name, str) else "Cursor direct binding is unsafe: %s" % name)
                continue
            if name in bound_names:
                errors.append("Cursor direct binding duplicates %s" % name)
                continue
            bound_names[name] = name
            destination = os.path.join(repo_root, ".cursor", "skills", name)
            if os.path.lexists(destination):
                errors.append("Cursor direct binding leftover native skill entry: %s" % name)
                continue
            shared = os.path.join(repo_root, ".agents", "skills", name)
            try:
                if _symlinked_ancestor(shared, repo_root):
                    errors.append("Cursor native-link ancestor is a symlink: %s" % name)
                    continue
                if not _inside_real_root(shared, repo_root):
                    errors.append("Cursor shared skill is missing: %s" % name)
                    continue
                shared_stat = os.lstat(shared)
                skill_md = os.path.join(shared, "SKILL.md")
                skill_stat = os.lstat(skill_md)
                if (stat.S_ISLNK(shared_stat.st_mode) or not stat.S_ISDIR(shared_stat.st_mode)
                        or stat.S_ISLNK(skill_stat.st_mode) or not stat.S_ISREG(skill_stat.st_mode)):
                    errors.append("Cursor shared skill is missing: %s" % name)
                    continue
            except OSError:
                errors.append("Cursor shared skill is missing: %s" % name)
                continue
        else:
            destination = binding.get("path")
            target = binding.get("target")
            if not isinstance(destination, str) or not isinstance(target, str):
                errors.append("Cursor native-link binding is malformed")
                continue
            name = destination.split("/")[-1]
            expected_path = ".cursor/skills/%s" % name
            expected_target = "../../.agents/skills/%s" % name
            if destination != expected_path or target != expected_target or not SKILL_NAME.fullmatch(name):
                errors.append("Cursor native-link binding is unsafe: %s" % destination)
                continue
            if name in bound_names:
                errors.append("Cursor native-link binding duplicates %s" % destination)
                continue
            bound_names[name] = destination
            projected = os.path.join(repo_root, *destination.split("/"))
            shared = os.path.join(repo_root, ".agents", "skills", name)
            try:
                if not os.path.islink(projected) or os.readlink(projected) != expected_target:
                    errors.append("Cursor native-link is missing or retargeted: %s" % destination)
                    continue
                if _symlinked_ancestor(os.path.dirname(projected), repo_root):
                    errors.append("Cursor native-link ancestor is a symlink: %s" % destination)
                    continue
                if _symlinked_ancestor(shared, repo_root):
                    errors.append("Cursor native-link ancestor is a symlink: %s" % name)
                    continue
                if not _inside_real_root(projected, repo_root) or not _inside_real_root(shared, repo_root):
                    errors.append("Cursor native-link target escapes the project: %s" % destination)
                    continue
                if os.path.realpath(projected) != os.path.realpath(shared):
                    errors.append("Cursor native-link is missing or retargeted: %s" % destination)
                    continue
                shared_stat = os.lstat(shared)
                skill_md = os.path.join(shared, "SKILL.md")
                skill_stat = os.lstat(skill_md)
                if (stat.S_ISLNK(shared_stat.st_mode) or not stat.S_ISDIR(shared_stat.st_mode)
                        or stat.S_ISLNK(skill_stat.st_mode) or not stat.S_ISREG(skill_stat.st_mode)):
                    errors.append("Cursor shared skill is missing: %s" % name)
                    continue
            except OSError:
                errors.append("Cursor native-link cannot be verified: %s" % destination)
                continue
        source = expected_skills.get(name)
        stable_id = skill_ids.get(name)
        if not source or not isinstance(stable_id, str):
            errors.append("Cursor native-link skill is not in the current Cursor source: %s" % name)
            continue
        try:
            shared_real = os.path.realpath(shared)
            repo_real = os.path.realpath(repo_root)
            current_source = _hash_path(source, plugin_root, False, False, budget)
            observed = _hash_path(shared_real, repo_real, False, True, budget)
        except CursorProjectLocalError as exc:
            errors.append("native-link skill %s cannot be validated: %s" % (name, exc))
            continue
        except OSError:
            errors.append("native-link skill %s is unreadable" % name)
            continue
        if current_source != observed:
            errors.append("native-link skill %s fingerprint mismatch (current source)" % name)
            continue
        hashed.append((stable_id, current_source))
    missing = sorted(set(expected_skills) - set(bound_names))
    if missing:
        errors.append("Cursor native-link is missing current skills entries: %s" % ", ".join(missing[:5]))
    hashed.sort(key=lambda item: item[0])
    return errors, hashed


def validate_cursor_project_local(repo_root):
    cursor_root = os.path.join(repo_root, ".cursor")
    receipt_path = os.path.join(cursor_root, ".dhpk-installed.json")
    errors = []
    try:
        receipt_stat = os.lstat(receipt_path)
        if not stat.S_ISREG(receipt_stat.st_mode) or stat.S_ISLNK(receipt_stat.st_mode):
            return False, "Cursor project-local receipt is not a regular file"
        if receipt_stat.st_size > RECEIPT_LIMIT:
            return False, "Cursor project-local receipt exceeds the 1 MiB validation limit"
        with open(receipt_path, encoding="utf-8") as handle:
            receipt = json.load(handle)
    except ValueError:
        return False, "Cursor project-local receipt is invalid JSON"
    except OSError:
        return False, "Cursor project-local receipt is unreadable"
    if not isinstance(receipt, dict):
        return False, "Cursor project-local receipt must be a JSON object"
    if os.path.islink(cursor_root) or not os.path.isdir(cursor_root):
        return False, "Cursor project-local projection root is missing or is a symlink"

    if receipt.get("schema_version") != 3:
        errors.append("receipt schema must be 3")
    if receipt.get("state") != "current":
        errors.append("receipt state is not current")
    plugin_version = receipt.get("plugin_version")
    if not isinstance(plugin_version, str) or not SEMVER.fullmatch(plugin_version):
        errors.append("receipt plugin version is invalid")
    source_fingerprint = receipt.get("source_fingerprint")
    if not isinstance(source_fingerprint, str) or not SHA256.fullmatch(source_fingerprint):
        errors.append("receipt source fingerprint is invalid")

    mode = receipt.get("mode")
    if mode not in ("copy", "symlink"):
        errors.append("receipt projection mode is invalid")
    managed = receipt.get("managed_entries")
    if not isinstance(managed, dict):
        errors.append("receipt is missing valid managed_entries")
        managed = {}
    unexpected_kinds = sorted(set(managed) - set(REQUIRED_KINDS))
    if unexpected_kinds:
        errors.append("unexpected managed entry kinds: %s" % ", ".join(unexpected_kinds[:10]))
    missing_kinds = [kind for kind in REQUIRED_NATIVE_KINDS if not isinstance(managed.get(kind), dict) or not managed.get(kind)]
    if missing_kinds:
        errors.append("missing managed entries: %s" % ", ".join(missing_kinds))
    leftover_managed_skills = sorted((managed.get("skills") or {}).keys()) if isinstance(managed.get("skills"), dict) else []
    if leftover_managed_skills:
        errors.append("leftover native skill copies: %s" % ", ".join(leftover_managed_skills[:10]))
    entry_count = sum(len(entries) for kind, entries in managed.items() if kind != "skills" and isinstance(entries, dict))
    if entry_count > ENTRY_LIMIT:
        errors.append("receipt managed entry count exceeds %d" % ENTRY_LIMIT)

    plugin_root, current_source_root, current_version = _current_source()
    if not plugin_root:
        return False, "Cursor project-local current source provenance is unavailable"
    symlink_source_root = None
    symlink_plugin_root = None
    if mode == "symlink" and isinstance(receipt.get("managed_entries"), dict):
        try:
            symlink_source_root, symlink_plugin_root = _symlink_source(managed, plugin_version)
        except CursorProjectLocalError as exc:
            errors.append(str(exc))
    if symlink_source_root and symlink_plugin_root:
        plugin_root = symlink_plugin_root
        current_source_root = symlink_source_root
        current_version = _manifest(
            os.path.join(plugin_root, ".claude-plugin", "plugin.json")
        ).get("version")
    if plugin_version != current_version:
        errors.append("receipt plugin version %s differs from source %s" % (plugin_version or "<missing>", current_version))
    try:
        expected = _expected_entries(plugin_root, current_source_root, receipt)
    except CursorProjectLocalError as exc:
        return False, "Cursor project-local validation failed: %s" % exc

    for kind in REQUIRED_NATIVE_KINDS:
        actual_names = set(managed.get(kind) or {}) if isinstance(managed.get(kind), dict) else set()
        expected_names = set(expected[kind])
        missing = sorted(expected_names - actual_names)
        stale = sorted(actual_names - expected_names)
        if missing:
            errors.append("receipt is missing current %s entries: %s" % (kind, ", ".join(missing[:5])))
        if stale:
            errors.append("receipt has stale %s entries: %s" % (kind, ", ".join(stale[:5])))

    aggregate = hashlib.sha256()
    hashed_entries = 0
    seen_destinations = set()
    budget = {"entries": 0, "bytes": 0}
    for kind in REQUIRED_NATIVE_KINDS:
        entries = managed.get(kind)
        if not isinstance(entries, dict):
            continue
        for name, entry in sorted(entries.items()):
            label = "%s/%s" % (kind, name)
            if name not in expected[kind] or not isinstance(entry, dict):
                continue
            source = entry.get("source")
            destination = entry.get("destination")
            if not _safe_relative(source) or not _safe_relative(destination):
                errors.append("managed entry %s has an unsafe path" % label)
                continue
            expected_relative = name if kind == "supporting_assets" else label
            if source != expected_relative or destination != expected_relative:
                errors.append("managed entry %s does not match its projection path" % label)
                continue
            if destination in seen_destinations:
                errors.append("managed entry %s duplicates projection path %s" % (label, destination))
                continue
            seen_destinations.add(destination)
            if entry.get("mode") != mode or entry.get("ownership_marker") != "%s:%s" % (mode, source):
                errors.append("managed entry %s has inconsistent ownership metadata" % label)
                continue
            recorded_source = entry.get("source_fingerprint")
            recorded_destination = entry.get("destination_fingerprint") or entry.get("fingerprint")
            if (not isinstance(recorded_source, str) or not SHA256.fullmatch(recorded_source)
                    or not isinstance(recorded_destination, str) or not SHA256.fullmatch(recorded_destination)):
                errors.append("managed entry %s has incomplete fingerprints" % label)
                continue
            projected = os.path.abspath(os.path.join(cursor_root, *destination.split("/")))
            if not _contained(projected, cursor_root) or not os.path.lexists(projected):
                errors.append("managed entry %s projection is missing" % label)
                continue
            if mode == "symlink" and (
                    not symlink_source_root
                    or not os.path.islink(projected)
                    or os.readlink(projected) != entry.get("destination_target")):
                errors.append("managed entry %s symlink target disagrees with approved source" % label)
                continue
            try:
                current_source = _hash_path(
                    expected[kind][name], plugin_root, False, False, budget,
                )
                observed_path = entry.get("destination_target") if mode == "symlink" else projected
                observed_source = _hash_path(
                    observed_path,
                    symlink_plugin_root if mode == "symlink" else cursor_root,
                    False,
                    mode == "copy",
                    budget,
                )
                observed_destination = _hash_path(
                    observed_path,
                    symlink_plugin_root if mode == "symlink" else cursor_root,
                    True,
                    mode == "copy",
                    budget,
                )
            except CursorProjectLocalError as exc:
                errors.append("managed entry %s cannot be validated: %s" % (label, exc))
                continue
            except OSError:
                errors.append("managed entry %s is unreadable" % label)
                continue
            mismatches = []
            if current_source != recorded_source:
                mismatches.append("current source")
            if observed_source != recorded_source:
                mismatches.append("projected source")
            if observed_destination != recorded_destination:
                mismatches.append("destination")
            if mismatches:
                errors.append("managed entry %s fingerprint mismatch (%s)" % (label, ", ".join(mismatches)))
                continue
            aggregate_label = destination if kind == "supporting_assets" else label
            aggregate.update(aggregate_label.encode("utf-8"))
            aggregate.update(b"\0")
            aggregate.update(current_source.encode("ascii"))
            aggregate.update(b"\0")
            hashed_entries += 1

    try:
        skill_ids = _skill_id_by_name(plugin_root, receipt)
    except CursorProjectLocalError as exc:
        return False, "Cursor project-local validation failed: %s" % exc
    native_link_errors, native_link_hashes = _validate_cursor_native_links(
        repo_root, plugin_root, expected.get("skills") or {}, skill_ids, budget,
    )
    errors.extend(native_link_errors)
    for stable_id, current_source in native_link_hashes:
        aggregate.update(("shared-skill:%s" % stable_id).encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(current_source.encode("ascii"))
        aggregate.update(b"\0")
        hashed_entries += 1

    expected_count = sum(len(entries) for entries in expected.values())
    if hashed_entries == expected_count and source_fingerprint and aggregate.hexdigest() != source_fingerprint:
        errors.append("receipt source fingerprint differs from the current Cursor source")
    if errors:
        return False, "Cursor project-local validation failed: %s" % "; ".join(errors[:10])
    return True, "Cursor project-local schema-v3 receipt and projection are current"
