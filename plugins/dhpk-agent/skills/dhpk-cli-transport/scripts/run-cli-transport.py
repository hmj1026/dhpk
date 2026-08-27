#!/usr/bin/env python3
"""Contained provider-neutral external CLI runner.

This internal entrypoint deliberately accepts a request file rather than a
prompt argument. Provider adapters own argv construction; this runner owns
validation, timeout observation, redaction, bounded evidence, and atomic
receipt/follow-up persistence.
"""
from __future__ import print_function

import argparse
import hashlib
import json
import os
import pwd
import re
import secrets
import signal
import stat
import subprocess
import sys
import threading
import time
import uuid

TERMINAL_STATUSES = frozenset(("SUCCEEDED", "FAILED", "BLOCKED", "TIMEOUT"))
TRANSPORT_PLACEHOLDERS = frozenset(("{prompt}", "{transport_output}"))
CONTEXT_FIELDS = (
    "requested_role", "effective_role", "role_contract", "mode", "workdir",
    "prompt_file", "artifact_root", "receipt_path", "assigned_files",
    "report_only", "timeout_secs", "task_id", "attempt_id",
    "transport", "requested_model", "requested_effort", "prompt_evidence",
)
MAX_AUTHORITY = {
    "codex-deep-reasoner": "read-only",
    "codex-fast-worker": "workspace-write",
    "agy-fast-worker": "workspace-write",
    "codex-bridge": "workspace-write",
}
AUTHORITY_RANK = {"read-only": 0, "workspace-write": 1}
REDACTION = re.compile(r"(?i)(bearer\s+|basic\s+|api[_-]?key[=:]\s*|token[=:]\s*|access_token[=:]\s*|refresh_token[=:]\s*|oauth_token[=:]\s*|password[=:]\s*|secret[=:]\s*|client_secret[=:]\s*|credential[=:]\s*|authorization[=:]\s*|aws_secret_access_key[=:]\s*|cookie[=:]\s*)(?:([\"'])(?:\\.|(?!\2).)*\2|([^\s]+))")
JSON_REDACTION = re.compile(r'(?i)("(?:api[_-]?key|token|access_token|refresh_token|oauth_token|password|secret|client_secret|credential|authorization|aws_secret_access_key|cookie)"\s*:\s*)"(?:\\.|[^"\\])*"')
TOKEN_REDACTION = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b")
PEM_REDACTION = re.compile(r"-----BEGIN [^-]+-----.*?-----END [^-]+-----", re.DOTALL)
ABSOLUTE_PATH = re.compile(r"(?<![A-Za-z0-9])/(?:[^\s'\"<>]+)")
CAPTURE_LIMIT = 4096
PROMPT_LIMIT = 1024 * 1024


class Blocked(Exception):
    pass


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def nofollow_real_directory(value, label, private=False):
    absolute = os.path.abspath(value)
    real = os.path.realpath(absolute)
    if absolute != real or os.path.islink(absolute) or not os.path.isdir(real):
        raise Blocked("%s must be an existing non-symlink directory" % label)
    info = os.stat(real)
    if private and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise Blocked("%s must be owned by the dispatching user and mode 0700" % label)
    return real


def contained_file(root, value, label):
    absolute = os.path.abspath(value)
    parent = os.path.dirname(absolute)
    if not absolute.startswith(root + os.sep) or os.path.commonpath((root, absolute)) != root:
        raise Blocked("%s is outside the approved artifact root" % label)
    if os.path.exists(absolute) and os.path.islink(absolute):
        raise Blocked("%s is a symlink" % label)
    parent_real = os.path.realpath(parent)
    if parent_real != parent or not parent_real.startswith(root + os.sep) and parent_real != root:
        raise Blocked("%s parent is not contained without symlink traversal" % label)
    if not os.path.isdir(parent_real):
        raise Blocked("%s parent does not exist" % label)
    return absolute


def atomic_json_at(directory_fd, name, payload):
    temporary = ".receipt-" + uuid.uuid4().hex
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory_fd)
    except OSError as error:
        raise Blocked("could not create immutable receipt temporary: %s" % error)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(payload, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            # link(2) gives create-if-absent semantics inside the pinned
            # artifact-root descriptor. os.replace would allow replacement.
            os.link(temporary, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd, follow_symlinks=False)
        except OSError as error:
            if getattr(error, "errno", None) == 17:
                raise Blocked("immutable receipt target already exists")
            raise Blocked("could not create immutable receipt target: %s" % error)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory_fd)
        except OSError:
            pass


def open_physical_directory(path, label, private=False):
    """Open every absolute-path component without following a symlink."""
    absolute = os.path.abspath(path)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = None
    try:
        descriptor = os.open(os.path.sep, flags)
        for component in [item for item in absolute.split(os.path.sep) if item]:
            child = os.open(component, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode):
            raise Blocked("%s must be a directory while pinned" % label)
        if private and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise Blocked("%s must remain private while pinned" % label)
        return absolute, descriptor
    except Blocked:
        if descriptor is not None:
            os.close(descriptor)
        raise
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
        raise Blocked("%s cannot be pinned: %s" % (label, error))


def open_pinned_child_directory(parent_fd, relative, label, private=False):
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    if relative in ("", "."):
        descriptor = os.dup(parent_fd)
    elif relative == ".." or relative.startswith(".." + os.sep):
        raise Blocked("%s is outside the pinned workdir" % label)
    else:
        descriptor = os.dup(parent_fd)
        try:
            for component in relative.split(os.sep):
                if not component or component in (".", ".."):
                    raise Blocked("%s path is invalid" % label)
                child = os.open(component, flags, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
        except Exception:
            os.close(descriptor)
            raise
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode):
            raise Blocked("%s must be a directory while pinned" % label)
        if private and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise Blocked("%s must remain private while pinned" % label)
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def pinned_artifact_root(path, workdir, workdir_fd):
    try:
        absolute = os.path.abspath(path)
        if os.path.commonpath((workdir, absolute)) != workdir:
            raise Blocked("artifact_root must be contained by workdir")
        relative = os.path.relpath(absolute, workdir)
        return absolute, open_pinned_child_directory(workdir_fd, relative, "artifact_root", private=True)
    except OSError as error:
        raise Blocked("artifact_root cannot be pinned: %s" % error)


def pinned_workdir(path):
    return open_physical_directory(path, "workdir")


def assert_pinned_workdir(path, descriptor):
    try:
        _current_path, current_fd = open_physical_directory(path, "workdir")
        pinned = os.fstat(descriptor)
        current = os.fstat(current_fd)
        os.close(current_fd)
    except (OSError, Blocked) as error:
        raise Blocked("workdir changed while provider ran: %s" % error)
    if current.st_dev != pinned.st_dev or current.st_ino != pinned.st_ino:
        raise Blocked("workdir changed while provider ran")


def assert_pinned_artifact_root(path, descriptor, workdir, workdir_fd):
    """Reject a post-launch artifact-root replacement before normal receipt publication."""
    try:
        current_workdir, current_workdir_fd = open_physical_directory(workdir, "workdir")
        pinned_workdir = os.fstat(workdir_fd)
        current_workdir_info = os.fstat(current_workdir_fd)
        os.close(current_workdir_fd)
        if (current_workdir_info.st_dev != pinned_workdir.st_dev or
                current_workdir_info.st_ino != pinned_workdir.st_ino):
            raise Blocked("workdir changed while provider ran")
        current_artifact_root, current_fd = open_physical_directory(path, "artifact_root", private=True)
        pinned = os.fstat(descriptor)
        current = os.fstat(current_fd)
        os.close(current_fd)
    except (OSError, Blocked) as error:
        raise Blocked("artifact_root changed while provider ran: %s" % error)
    if current.st_dev != pinned.st_dev or current.st_ino != pinned.st_ino:
        raise Blocked("artifact_root changed while provider ran")
    if os.path.commonpath((current_workdir, current_artifact_root)) != current_workdir:
        raise Blocked("artifact_root is no longer contained by workdir")


def private_temporary_directory(parent_fd):
    for _unused in range(32):
        name = ".cli-transport-" + secrets.token_hex(16)
        try:
            os.mkdir(name, 0o700, dir_fd=parent_fd)
            descriptor = os.open(name, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd)
            if os.fstat(descriptor).st_mode & 0o077:
                os.close(descriptor)
                raise Blocked("transport temporary directory is not private")
            return name, descriptor
        except FileExistsError:
            continue
        except OSError as error:
            raise Blocked("could not create private transport temporary directory: %s" % error)
    raise Blocked("could not allocate a unique transport temporary directory")


def assert_pinned_temporary(parent_fd, name, descriptor):
    try:
        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        pinned = os.fstat(descriptor)
    except OSError as error:
        raise Blocked("transport temporary directory changed while provider ran: %s" % error)
    if (not stat.S_ISDIR(current.st_mode) or stat.S_ISLNK(current.st_mode) or
            current.st_mode & 0o077 or current.st_dev != pinned.st_dev or current.st_ino != pinned.st_ino):
        raise Blocked("transport temporary directory changed while provider ran")


def remove_private_temporary(parent_fd, name, descriptor):
    try:
        for entry in os.listdir(descriptor):
            try:
                os.unlink(entry, dir_fd=descriptor)
            except OSError:
                pass
    finally:
        try:
            os.close(descriptor)
        finally:
            try:
                os.rmdir(name, dir_fd=parent_fd)
            except OSError:
                pass


def report_pipe(directory_fd, directory_path):
    name = "provider-output"
    try:
        os.mkfifo(name, 0o600, dir_fd=directory_fd)
        reader = os.open(name, os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
        os.set_blocking(reader, True)
        keepalive = os.open(name, os.O_WRONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
        return os.path.join(directory_path, name), reader, keepalive
    except OSError as error:
        raise Blocked("could not create bounded provider output stream: %s" % error)


def redact_text(raw, private_roots=()):
    text = raw.decode("utf-8", "replace")
    text = REDACTION.sub(r"\1[REDACTED]", text)
    text = JSON_REDACTION.sub(r'\1"[REDACTED]"', text)
    text = TOKEN_REDACTION.sub("[REDACTED]", text)
    text = PEM_REDACTION.sub("[REDACTED_PEM]", text)
    for root in private_roots:
        if root:
            text = text.replace(root, "[PRIVATE_PATH]")
    return ABSOLUTE_PATH.sub("[PRIVATE_PATH]", text)


def redacted_metadata(value):
    try:
        raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError):
        return {"redacted": "[INVALID_METADATA]"}
    if len(raw) > CAPTURE_LIMIT:
        return {"redacted": "[METADATA_EXCEEDS_CAPTURE_LIMIT]"}
    try:
        return json.loads(redact_text(raw))
    except ValueError:
        return {"redacted": "[INVALID_METADATA]"}


def redact_and_digest(raw, private_roots=()):
    text = redact_text(raw, private_roots)
    return canonical_digest({"capture": text[:CAPTURE_LIMIT]}), len(text) > CAPTURE_LIMIT


def redacted_capture(raw, private_roots=()):
    return redact_text(raw, private_roots)[:CAPTURE_LIMIT]


def snapshot(workdir, excluded_paths=()):
    result = {}
    excluded = tuple(os.path.abspath(item) for item in excluded_paths)
    def is_excluded(candidate):
        absolute = os.path.abspath(candidate)
        return any(absolute == item or absolute.startswith(item + os.sep) for item in excluded)
    for parent, dirs, files in os.walk(workdir):
        if is_excluded(parent):
            dirs[:] = []
            continue
        retained_dirs = []
        for name in dirs:
            candidate = os.path.join(parent, name)
            if is_excluded(candidate):
                continue
            retained_dirs.append(name)
        dirs[:] = retained_dirs
        for name in dirs + files:
            candidate = os.path.join(parent, name)
            try:
                info = os.lstat(candidate)
            except OSError:
                continue
            relative = os.path.relpath(candidate, workdir)
            if stat.S_ISLNK(info.st_mode):
                result[relative] = ("symlink", os.readlink(candidate), info.st_mtime_ns, info.st_ctime_ns)
            elif stat.S_ISDIR(info.st_mode):
                # A directory's mtime changes when the runner creates its own
                # contained files. File and new-directory entries still make
                # provider-created paths observable without treating that
                # bookkeeping as an out-of-scope write.
                result[relative] = ("directory", info.st_dev, info.st_ino)
            else:
                result[relative] = (
                    "entry", stat.S_IFMT(info.st_mode), info.st_dev, info.st_ino,
                    info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink,
                )
    return result


def symlink_paths(snapshot_data):
    return sorted(name for name, detail in snapshot_data.items() if detail[0] == "symlink")


def hardlink_paths(snapshot_data):
    return sorted(name for name, detail in snapshot_data.items() if detail[0] == "entry" and detail[-1] > 1)


def changed_outside_scope(before, after, assigned):
    changed = {name for name in set(before) | set(after) if before.get(name) != after.get(name)}
    allowed = set(assigned)
    return sorted(name for name in changed if name not in allowed)


def read_attested_context(request):
    attestation = request.get("attestation")
    if not isinstance(attestation, dict):
        raise Blocked("runner request is missing attested caller context")
    path = attestation.get("context_path")
    expected_sha256 = attestation.get("context_sha256")
    if not isinstance(path, str) or not os.path.isabs(path) or not re.match(r"^[0-9a-f]{64}$", expected_sha256 or ""):
        raise Blocked("attested context binding is invalid")
    try:
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_mode & 0o077:
            raise Blocked("attested context must be a private regular non-symlink file")
        if before.st_uid != os.getuid():
            raise Blocked("attested context must be owned by the dispatching user")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            pinned = os.fstat(handle.fileno())
            if pinned.st_dev != before.st_dev or pinned.st_ino != before.st_ino:
                raise Blocked("attested context changed while opening")
            raw = handle.read()
    except OSError as error:
        raise Blocked("attested context is unavailable: %s" % error)
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise Blocked("attested context digest does not match")
    try:
        context = json.loads(raw.decode("utf-8"))
    except Exception as error:
        raise Blocked("attested context is invalid JSON: %s" % error)
    if not isinstance(context, dict) or context.get("schema") != "dhpk.cli.context.v1":
        raise Blocked("attested context schema is invalid")
    if context.get("provider") != request.get("provider"):
        raise Blocked("attested context provider does not match request")
    for field in CONTEXT_FIELDS:
        if context.get(field) != request.get(field):
            raise Blocked("attested context %s does not match request" % field)
    if context.get("runtime_path") != request.get("runtime_source_path"):
        raise Blocked("attested context runtime_path does not match request")
    return context


def file_sha256(path, label):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise Blocked("%s must be a regular file" % label)
            digest = hashlib.sha256()
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
            return digest.hexdigest()
    except OSError as error:
        raise Blocked("%s is unavailable: %s" % (label, error))


def attested_runtime_plan(context):
    source = context.get("runtime_path")
    if not isinstance(source, str) or not source:
        raise Blocked("attested context is missing restricted runtime_path")
    source_dirs = source.split(os.pathsep)
    if len(source_dirs) > 3 or any(not item or not os.path.isabs(item) for item in source_dirs):
        raise Blocked("attested runtime_path is invalid")
    for directory in source_dirs:
        try:
            info = os.stat(directory)
        except OSError as error:
            raise Blocked("attested runtime_path is unavailable: %s" % error)
        if os.path.realpath(directory) != directory or not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o022 or info.st_uid not in (0, os.getuid()):
            raise Blocked("attested runtime_path contains an untrusted directory")
    locations, directories = {}, []
    for name in (context["provider"], "python3", "bash"):
        candidate = next((os.path.join(directory, name) for directory in source_dirs
                          if os.path.isfile(os.path.join(directory, name)) and os.access(os.path.join(directory, name), os.X_OK)), None)
        if not candidate:
            raise Blocked("attested runtime_path is missing named executable %s" % name)
        resolved = os.path.realpath(candidate)
        try:
            info = os.lstat(resolved)
        except OSError as error:
            raise Blocked("attested runtime executable is unavailable: %s" % error)
        if (not os.path.isfile(resolved) or not os.access(resolved, os.X_OK) or
                not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or
                info.st_mode & 0o022 or info.st_uid not in (0, os.getuid())):
            raise Blocked("attested runtime executable is invalid: %s" % name)
        locations[name] = resolved
        directory = os.path.dirname(resolved)
        if directory not in directories:
            directories.append(directory)
    evidence = {name: {"path": value, "sha256": file_sha256(value, "attested runtime executable")} for name, value in locations.items()}
    return locations, os.pathsep.join(directories), evidence


def restricted_runtime_path(request, context):
    locations, expected_path, evidence = attested_runtime_plan(context)
    if request.get("runtime_source_path") != context["runtime_path"] or request.get("runtime_path") != expected_path or request.get("runtime_executables") != evidence:
        raise Blocked("runtime request values do not match attested context")
    return expected_path, locations[context["provider"]]


def assert_attested_runtime_executable(path, evidence, name):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise Blocked("attested runtime executable changed before launch: %s" % error)
    if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or
            info.st_mode & 0o022 or info.st_uid not in (0, os.getuid()) or
            file_sha256(path, "attested runtime executable") != evidence.get("sha256")):
        raise Blocked("attested runtime executable changed before launch: %s" % name)


def provider_command_validation(request, workdir, executable):
    command = request["command"]
    provider = request["provider"]
    if provider == "codex":
        expected = ["exec", "--skip-git-repo-check", "--sandbox", request["mode"],
                    "-c", "approval_policy=never", "--cd", workdir]
        if request.get("requested_model"):
            expected.extend(("-m", request["requested_model"]))
        if request.get("requested_effort") and request["requested_effort"] != "ultra":
            expected.extend(("-c", "model_reasoning_effort=" + request["requested_effort"]))
        expected.extend(("--output-last-message", "{transport_output}", "-"))
        if command != [executable] + expected:
            raise Blocked("Codex command does not match the contained transport contract")
    else:
        expected = ["--dangerously-skip-permissions", "--mode", "accept-edits",
                    "--add-dir", workdir, "--model", request.get("requested_model"),
                    "--print-timeout", "300s"]
        if command != [executable] + expected + ["-p", "{prompt}"]:
            raise Blocked("AGY command does not match the contained transport contract")
        if "{transport_output}" in command:
            raise Blocked("AGY command must not claim Codex output transport")


def reject_reserved_transport_placeholders(request):
    for field in ("requested_model", "workdir"):
        value = request.get(field)
        if isinstance(value, str) and any(marker in value for marker in TRANSPORT_PLACEHOLDERS):
            raise Blocked("%s must not contain a reserved transport placeholder" % field)


def role_validation(request):
    role = request.get("effective_role")
    contract = request.get("role_contract")
    if not isinstance(contract, dict) or contract.get("schema") != "dhpk.role-contract.v1":
        raise Blocked("role_contract must use dhpk.role-contract.v1")
    if set(contract) != set(("schema", "requested_role", "effective_role", "authority", "source_id", "evidence_sha256")):
        raise Blocked("role_contract contains unsupported fields")
    fields = {key: contract.get(key) for key in ("requested_role", "effective_role", "authority", "source_id")}
    if fields["requested_role"] != request.get("requested_role") or fields["effective_role"] != role:
        raise Blocked("role contract values do not match request")
    if fields["authority"] not in ("read-only", "workspace-write"):
        raise Blocked("role contract authority is invalid")
    if not re.match(r"^[a-z0-9][a-z0-9._-]*$", fields["source_id"] or ""):
        raise Blocked("role contract source_id is invalid")
    if contract.get("evidence_sha256") != canonical_digest(fields):
        raise Blocked("role contract digest does not match canonical fields")
    requested_maximum = MAX_AUTHORITY.get(request.get("requested_role"))
    effective_maximum = MAX_AUTHORITY.get(role)
    if requested_maximum is None or effective_maximum is None:
        raise Blocked("role contract role is unknown")
    if request.get("requested_role") != role:
        raise Blocked("role labels must be canonicalized before the contained runner")
    maximum = min(AUTHORITY_RANK[requested_maximum], AUTHORITY_RANK[effective_maximum])
    if AUTHORITY_RANK[fields["authority"]] > maximum:
        raise Blocked("role contract authority exceeds or contradicts role maximum")
    if request.get("mode") not in ("read-only", "workspace-write"):
        raise Blocked("mode is invalid")
    if AUTHORITY_RANK[request["mode"]] > AUTHORITY_RANK[fields["authority"]]:
        raise Blocked("read-only authority cannot be widened")
    return contract


def stdin_payload(request, prompt):
    mode = request.get("stdin_mode")
    if mode == "none":
        return b""
    if mode == "prompt":
        descriptor = os.open(prompt, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            info = os.fstat(handle.fileno())
            evidence = request.get("prompt_evidence") or {}
            if not stat.S_ISREG(info.st_mode):
                raise Blocked("prompt_file must be a regular non-symlink file")
            payload = handle.read(PROMPT_LIMIT + 1)
        if evidence.get("path") != os.path.realpath(prompt) or evidence.get("dev") != info.st_dev or evidence.get("ino") != info.st_ino or evidence.get("sha256") != hashlib.sha256(payload).hexdigest():
            raise Blocked("prompt_file no longer matches its attested evidence")
        if len(payload) > PROMPT_LIMIT:
            raise Blocked("prompt exceeds the bounded stdin limit")
        return payload
    if mode == "agy-confirmation":
        return b"Y\n"
    raise Blocked("stdin_mode must be one of none, prompt, or agy-confirmation")


def validate(request):
    if request.get("schema") != "dhpk.cli.request.v1":
        raise Blocked("request schema must be dhpk.cli.request.v1")
    if request.get("provider") not in ("codex", "agy"):
        raise Blocked("provider is invalid")
    if not isinstance(request.get("task_id"), str) or not request["task_id"] or not isinstance(request.get("attempt_id"), str) or not request["attempt_id"]:
        raise Blocked("task_id and attempt_id are required")
    if not isinstance(request.get("assigned_files"), list) or any(not isinstance(name, str) or not name or os.path.isabs(name) or ".." in name.split(os.sep) for name in request["assigned_files"]):
        raise Blocked("assigned_files must be bounded repository-relative paths")
    if not isinstance(request.get("timeout_secs"), int) or request["timeout_secs"] < 0:
        raise Blocked("timeout_secs must be a non-negative integer")
    if request.get("report_only") is not True:
        raise Blocked("report_only must be explicitly true")
    if request.get("transport") not in ("codex-exec", "agy-print"):
        raise Blocked("transport is invalid")
    if request.get("transport") != ("codex-exec" if request.get("provider") == "codex" else "agy-print"):
        raise Blocked("transport does not match provider")
    if request.get("requested_model") is not None and (not isinstance(request.get("requested_model"), str) or len(request["requested_model"]) > 160 or "\x00" in request["requested_model"]):
        raise Blocked("requested_model is invalid")
    if request.get("requested_effort") not in (None, "low", "medium", "high", "xhigh", "ultra"):
        raise Blocked("requested_effort is invalid")
    reject_reserved_transport_placeholders(request)
    if not isinstance(request.get("adapter_metadata") or {}, dict):
        raise Blocked("adapter_metadata is invalid")
    if not isinstance(request.get("command"), list) or not request["command"] or any(not isinstance(value, str) or not value for value in request["command"]):
        raise Blocked("adapter command must be a non-empty argv list")
    context = read_attested_context(request)
    runtime_path, executable = restricted_runtime_path(request, context)
    workdir, workdir_fd = pinned_workdir(request.get("workdir", ""))
    try:
        artifact_root, artifact_fd = pinned_artifact_root(request.get("artifact_root", ""), workdir, workdir_fd)
    except Exception:
        os.close(workdir_fd)
        raise
    try:
        receipt_path = contained_file(artifact_root, request.get("receipt_path", ""), "receipt_path")
        if os.path.dirname(receipt_path) != artifact_root:
            raise Blocked("receipt_path must be directly contained by artifact_root")
    except Exception:
        os.close(artifact_fd)
        os.close(workdir_fd)
        raise
    try:
        prompt = request.get("prompt_file", "")
        try:
            prompt_info = os.lstat(prompt)
        except OSError as error:
            raise Blocked("prompt_file is unavailable: %s" % error)
        if not stat.S_ISREG(prompt_info.st_mode) or stat.S_ISLNK(prompt_info.st_mode):
            raise Blocked("prompt_file must be a regular non-symlink file")
        if request.get("stdin_mode") not in ("none", "prompt", "agy-confirmation"):
            raise Blocked("stdin_mode must be explicit and bounded")
        if request.get("provider") == "codex" and request["stdin_mode"] != "prompt":
            raise Blocked("Codex transport requires prompt stdin mode")
        if request.get("provider") == "agy" and request["stdin_mode"] != "agy-confirmation":
            raise Blocked("AGY transport requires confirmation stdin mode")
        provider_command_validation(request, workdir, executable)
        contract = role_validation(request)
        return workdir, artifact_root, receipt_path, prompt, contract, runtime_path, workdir_fd, artifact_fd
    except Exception:
        os.close(artifact_fd)
        os.close(workdir_fd)
        raise


def receipt(request, status, **extra):
    result = {
        "schema": "dhpk.cli.receipt.v1", "status": status,
        "requested_provider": request.get("provider"), "effective_provider": request.get("provider"),
        "provider": request.get("provider"),
        "requested_role": request.get("requested_role"), "effective_role": request.get("effective_role"),
        "requested_transport": request.get("transport"), "effective_transport": request.get("transport"),
        "transport": request.get("transport"), "mode": request.get("mode"), "task_id": request.get("task_id"),
        "attempt_id": request.get("attempt_id"), "launch_id": uuid.uuid4().hex,
        "requested_model": request.get("requested_model"), "requested_effort": request.get("requested_effort"),
        "effective_model": "unknown", "effective_effort": "unknown", "model_evidence": "unavailable",
        "verification": "not-run", "verified_timeout": False,
        "exit_code": None, "timeout_secs": request.get("timeout_secs"), "enforced_timeout": False,
        "report_present": False, "report_sha256": None,
        "assigned_scope_sha256": canonical_digest(sorted(request.get("assigned_files") or [])),
        "adapter_metadata": redacted_metadata(request.get("adapter_metadata") or {}),
    }
    result.update(extra)
    return result


def persist(request, artifact_fd, receipt_path, payload):
    follow = {"schema": "dhpk.cli.follow-up.v1", "receipt_launch_id": payload["launch_id"], "terminal_status": payload["status"], "immutable": True}
    # Keep the follow-up record inside the one immutable receipt. Two sibling
    # files cannot be committed atomically without risking an orphan if the
    # second link fails.
    payload["follow_up"] = {"record": follow, "sha256": canonical_digest(follow)}
    atomic_json_at(artifact_fd, os.path.basename(receipt_path), payload)


def read_bounded_file(path, label):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise Blocked("%s must be a regular file" % label)
            return handle.read(CAPTURE_LIMIT + 1)
    except OSError as error:
        raise Blocked("%s is unavailable: %s" % (label, error))


def drain_bounded(handle, destination):
    try:
        while True:
            chunk = handle.read(8192)
            if not chunk:
                return
            if len(destination) < CAPTURE_LIMIT + 1:
                destination.extend(chunk[:CAPTURE_LIMIT + 1 - len(destination)])
    finally:
        handle.close()


def process_group_has_live_members(group_id):
    """Return true only while a process group has a non-zombie member.

    Linux can retain a killed descendant as a zombie briefly after its leader
    has been reaped.  `killpg(group_id, 0)` treats that already-terminated
    process as group liveness, so inspect `/proc` when available.  If the
    process table cannot be inspected, retain the conservative signal probe.
    """
    try:
        members = os.listdir("/proc")
    except OSError:
        try:
            os.killpg(group_id, 0)
        except OSError:
            return False
        return True
    for member in members:
        if not member.isdigit():
            continue
        try:
            with open(os.path.join("/proc", member, "stat"), "r") as handle:
                fields = handle.read().rsplit(")", 1)[1].split()
            if len(fields) >= 3 and fields[0] != "Z" and int(fields[2]) == group_id:
                return True
        except (OSError, IndexError, ValueError):
            continue
    return False


def write_stdin(handle, payload):
    try:
        if payload:
            handle.write(payload)
            handle.flush()
    except OSError:
        pass
    finally:
        handle.close()


def read_private_request(path):
    try:
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_mode & 0o077 or before.st_uid != os.getuid():
            raise Blocked("request file must be a private regular non-symlink file")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            pinned = os.fstat(handle.fileno())
            if pinned.st_dev != before.st_dev or pinned.st_ino != before.st_ino:
                raise Blocked("request file changed while opening")
            return json.loads(handle.read().decode("utf-8"))
    except Blocked:
        raise
    except (OSError, ValueError) as error:
        raise Blocked("request file is invalid: %s" % error)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        request = read_private_request(args.request)
    except Blocked as error:
        print("dhpk-cli-transport: BLOCKED: %s" % error, file=sys.stderr)
        return 64
    receipt_path = None
    workdir_fd = None
    artifact_fd = None
    contract = None
    try:
        workdir, artifact_root, receipt_path, prompt, contract, runtime_path, workdir_fd, artifact_fd = validate(request)
        if os.path.lexists(receipt_path):
            raise Blocked("immutable receipt target already exists")
        before = snapshot(workdir)
        preexisting_symlinks = symlink_paths(before)
        if preexisting_symlinks:
            raise Blocked("workspace symlinks are not permitted by contained transport: %s" % ", ".join(preexisting_symlinks))
        preexisting_hardlinks = hardlink_paths(before)
        if preexisting_hardlinks:
            raise Blocked("workspace hardlinks are not permitted by contained transport: %s" % ", ".join(preexisting_hardlinks))
        temporary_name, temporary_fd = private_temporary_directory(artifact_fd)
        temporary = os.path.join(artifact_root, temporary_name)
        try:
            report_capture = bytearray()
            report_thread = None
            report_keepalive = None
            provider_output = None
            if any("{transport_output}" in value for value in request["command"]):
                provider_output, report_reader, report_keepalive = report_pipe(temporary_fd, temporary)
                report_thread = threading.Thread(target=drain_bounded, args=(os.fdopen(report_reader, "rb", 0), report_capture))
                report_thread.start()
            command = list(request["command"])
            if provider_output is not None:
                command[command.index("{transport_output}")] = provider_output
            if "{prompt}" in command:
                prompt_request = dict(request)
                prompt_request["stdin_mode"] = "prompt"
                prompt_bytes = stdin_payload(prompt_request, prompt)
                if len(prompt_bytes) > PROMPT_LIMIT:
                    raise Blocked("prompt exceeds the bounded argv limit")
                prompt_text = prompt_bytes.decode("utf-8", "replace")
                command[command.index("{prompt}")] = prompt_text
            stdin = stdin_payload(request, prompt)
            started = time.time()
            runtime_env = {"PATH": runtime_path, "HOME": pwd.getpwuid(os.getuid()).pw_dir}
            process = None
            stdout_thread = stderr_thread = stdin_thread = None
            try:
                def enter_pinned_workdir():
                    os.fchdir(workdir_fd)
                assert_attested_runtime_executable(
                    command[0], request["runtime_executables"][request["provider"]], request["provider"],
                )
                process = subprocess.Popen(command, cwd=None, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, start_new_session=True, env=runtime_env, preexec_fn=enter_pinned_workdir)
                output_capture, error_capture = bytearray(), bytearray()
                stdout_thread = threading.Thread(target=drain_bounded, args=(process.stdout, output_capture))
                stderr_thread = threading.Thread(target=drain_bounded, args=(process.stderr, error_capture))
                stdin_thread = threading.Thread(target=write_stdin, args=(process.stdin, stdin))
                stdout_thread.start(); stderr_thread.start(); stdin_thread.start()
                try:
                    try:
                        process.wait(timeout=request["timeout_secs"] or None)
                        timed_out = False
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except OSError:
                            process.kill()
                        try:
                            process.wait(timeout=5)
                        except OSError:
                            raise Blocked("provider did not terminate after timeout")
                        except subprocess.TimeoutExpired:
                            raise Blocked("provider did not terminate after timeout")
                        deadline = time.monotonic() + 5
                        while process_group_has_live_members(process.pid) and time.monotonic() < deadline:
                            time.sleep(0.02)
                        if process_group_has_live_members(process.pid):
                            raise Blocked("provider process group did not terminate after timeout")
                        timed_out = True
                finally:
                    for thread in (stdin_thread, stdout_thread, stderr_thread):
                        if thread is not None:
                            thread.join(5)
            except OSError as error:
                raise Blocked("provider command could not start: %s" % error)
            finally:
                if report_keepalive is not None:
                    os.close(report_keepalive)
                    report_keepalive = None
                if report_thread is not None:
                    report_thread.join(5)
                    if report_thread.is_alive():
                        raise Blocked("bounded provider output stream did not terminate")
            output, errors = bytes(output_capture), bytes(error_capture)
            elapsed = round(time.time() - started, 3)
            report = bytes(report_capture) if report_thread is not None else output
            private_roots = (workdir, artifact_root, temporary)
            output_digest, output_truncated = redact_and_digest(output, private_roots)
            error_digest, error_truncated = redact_and_digest(errors, private_roots)
            assert_pinned_workdir(workdir, workdir_fd)
            assert_pinned_temporary(artifact_fd, temporary_name, temporary_fd)
            after = snapshot(workdir, (temporary,))
            outside = changed_outside_scope(before, after, request["assigned_files"])
            unsafe_symlinks = symlink_paths(after)
            unsafe_hardlinks = hardlink_paths(after)
            temporary_entries = snapshot(temporary)
            allowed_temp_entries = set(("provider-output",))
            unsafe_temporary_entries = sorted(name for name, detail in temporary_entries.items()
                                              if name not in allowed_temp_entries or detail[0] in ("symlink", "directory") or (detail[0] == "entry" and detail[-1] > 1))
            if unsafe_symlinks or unsafe_hardlinks or unsafe_temporary_entries:
                outside = sorted(set(outside) | set(unsafe_symlinks) | set(unsafe_hardlinks) | set(".cli-transport/" + name for name in unsafe_temporary_entries))
            if timed_out:
                status, exit_code = "TIMEOUT", 124
            elif outside:
                status, exit_code = "FAILED", getattr(process, "returncode", 1) or 1
            elif process.returncode == 0 and report:
                status, exit_code = "SUCCEEDED", 0
            elif process.returncode == 0:
                status, exit_code = "FAILED", 1
            else:
                status, exit_code = "FAILED", process.returncode or 1
            payload = receipt(request, status, role_contract=contract, exit_code=exit_code,
                timeout_secs=request["timeout_secs"], enforced_timeout=timed_out, verified_timeout=timed_out, elapsed_secs=elapsed,
                stdin_mode=request["stdin_mode"],
                stdout_sha256=output_digest, stderr_sha256=error_digest,
                report_present=bool(report), report_sha256=canonical_digest({"capture": redacted_capture(report, private_roots)}),
                capture_truncated=output_truncated or error_truncated or len(report) > CAPTURE_LIMIT, out_of_scope_paths=outside)
            assert_pinned_artifact_root(artifact_root, artifact_fd, workdir, workdir_fd)
            persist(request, artifact_fd, receipt_path, payload)
            if status == "SUCCEEDED" and report:
                sys.stdout.write(redacted_capture(report, private_roots))
            return exit_code
        finally:
            remove_private_temporary(artifact_fd, temporary_name, temporary_fd)
    except Blocked as error:
        if receipt_path and artifact_fd is not None:
            try:
                assert_pinned_artifact_root(request.get("artifact_root", ""), artifact_fd, request.get("workdir", ""), workdir_fd)
                private_roots = (request.get("workdir", ""), request.get("artifact_root", ""))
                persist(request, artifact_fd, receipt_path, receipt(
                    request, "BLOCKED", role_contract=contract, exit_code=65,
                    timeout_secs=request.get("timeout_secs"), enforced_timeout=False, verified_timeout=False,
                    reason=redact_text(str(error).encode("utf-8"), private_roots),
                ))
            except Exception:
                pass
        print("dhpk-cli-transport: BLOCKED: %s" % redact_text(str(error).encode("utf-8"), (request.get("workdir", ""), request.get("artifact_root", ""))), file=sys.stderr)
        return 65
    finally:
        if workdir_fd is not None:
            os.close(workdir_fd)
        if artifact_fd is not None:
            os.close(artifact_fd)


if __name__ == "__main__":
    sys.exit(main())
