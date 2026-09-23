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


def _expected_entries(plugin_root, source_root, receipt):
    expected = {}
    for kind in REQUIRED_KINDS[:-1]:
        kind_root = os.path.join(source_root, kind)
        if not os.path.isdir(kind_root):
            raise CursorProjectLocalError("current Cursor source is missing %s" % kind)
        names = _selected_skill_names(plugin_root, receipt) if kind == "skills" else sorted(os.listdir(kind_root))
        expected[kind] = {
            name: os.path.join(kind_root, name)
            for name in names
            if not _ignored(name) and os.path.lexists(os.path.join(kind_root, name))
        }

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
    for kind in REQUIRED_KINDS:
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
    missing_kinds = [kind for kind in REQUIRED_KINDS if not isinstance(managed.get(kind), dict) or not managed.get(kind)]
    if missing_kinds:
        errors.append("missing managed entries: %s" % ", ".join(missing_kinds))
    entry_count = sum(len(entries) for entries in managed.values() if isinstance(entries, dict))
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

    for kind in REQUIRED_KINDS:
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
    for kind in REQUIRED_KINDS:
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

    expected_count = sum(len(entries) for entries in expected.values())
    if hashed_entries == expected_count and source_fingerprint and aggregate.hexdigest() != source_fingerprint:
        errors.append("receipt source fingerprint differs from the current Cursor source")
    if errors:
        return False, "Cursor project-local validation failed: %s" % "; ".join(errors[:10])
    return True, "Cursor project-local schema-v3 receipt and projection are current"
