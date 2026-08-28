#!/usr/bin/env python3
"""Translate an attested caller context into one immutable runner request."""
from __future__ import print_function

import argparse
import hashlib
import json
import os
import stat
import sys


class Blocked(Exception):
    pass


CONTEXT_FIELDS = (
    "requested_role", "effective_role", "role_contract", "mode", "workdir",
    "prompt_file", "artifact_root", "receipt_path", "assigned_files",
    "report_only", "timeout_secs", "task_id", "attempt_id",
    "transport", "requested_model", "requested_effort", "prompt_evidence",
)


def context_file(path):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise Blocked("attested context is unavailable: %s" % error)
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise Blocked("attested context must be a regular non-symlink file")
    if info.st_mode & 0o077:
        raise Blocked("attested context must not grant group or other access")
    if info.st_uid != os.getuid():
        raise Blocked("attested context must be owned by the dispatching user")
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            pinned = os.fstat(handle.fileno())
            if pinned.st_dev != info.st_dev or pinned.st_ino != info.st_ino:
                raise Blocked("attested context changed while opening")
            raw = handle.read()
            payload = json.loads(raw.decode("utf-8"))
    except Exception as error:
        raise Blocked("attested context is invalid JSON: %s" % error)
    if not isinstance(payload, dict) or payload.get("schema") != "dhpk.cli.context.v1":
        raise Blocked("attested context must use dhpk.cli.context.v1")
    for field in CONTEXT_FIELDS:
        if field not in payload:
            raise Blocked("attested context is missing %s" % field)
    return payload, os.path.realpath(path), hashlib.sha256(raw).hexdigest()


def same_real_path(left, right, label):
    if os.path.realpath(left) != os.path.realpath(right):
        raise Blocked("attested context %s does not match adapter argument" % label)


def require_regular_nofollow(path, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise Blocked("%s is unavailable: %s" % (label, error))
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise Blocked("%s must be a regular non-symlink file" % label)
    return os.path.realpath(path)


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_evidence(path, label):
    try:
        before = os.lstat(path)
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            pinned = os.fstat(handle.fileno())
            if not stat.S_ISREG(pinned.st_mode) or before.st_dev != pinned.st_dev or before.st_ino != pinned.st_ino:
                raise Blocked("%s changed while opening" % label)
            return {"path": os.path.realpath(path), "dev": pinned.st_dev, "ino": pinned.st_ino, "sha256": hashlib.sha256(handle.read()).hexdigest()}
    except OSError as error:
        raise Blocked("%s is unavailable: %s" % (label, error))


def trusted_runtime_directory(path):
    info = os.stat(path)
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o022 or info.st_uid not in (0, os.getuid()):
        raise Blocked("attested runtime_path contains an untrusted directory")


def trusted_runtime_executable(path, name):
    try:
        info = os.lstat(path)
    except OSError as error:
        raise Blocked("restricted runtime executable is unavailable: %s" % error)
    if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or
            info.st_mode & 0o022 or info.st_uid not in (0, os.getuid())):
        raise Blocked("restricted runtime executable is mutable or untrusted: %s" % name)


def runtime_plan(context, provider):
    names = (provider, "python3", "bash")
    locations = {}
    directories = []
    configured = context.get("runtime_path")
    if not isinstance(configured, str) or not configured:
        raise Blocked("attested context is missing restricted runtime_path")
    source_dirs = configured.split(os.pathsep)
    if len(source_dirs) > 3 or any(not item or not os.path.isabs(item) for item in source_dirs):
        raise Blocked("attested runtime_path is invalid")
    for directory in source_dirs:
        if os.path.realpath(directory) != directory:
            raise Blocked("attested runtime_path must not traverse symlinks")
        trusted_runtime_directory(directory)
    for name in names:
        candidate = next((os.path.join(directory, name) for directory in source_dirs
                          if os.path.isfile(os.path.join(directory, name)) and os.access(os.path.join(directory, name), os.X_OK)), None)
        if not candidate:
            raise Blocked("attested restricted runtime is missing named executable %s" % name)
        resolved = os.path.realpath(candidate)
        if not os.path.isfile(resolved) or not os.access(resolved, os.X_OK):
            raise Blocked("restricted runtime executable is invalid: %s" % name)
        trusted_runtime_executable(resolved, name)
        locations[name] = resolved
        directory = os.path.dirname(resolved)
        if directory not in directories:
            directories.append(directory)
    evidence = {name: {"path": path, "sha256": file_sha256(path)} for name, path in locations.items()}
    return locations, os.pathsep.join(directories), evidence


def codex_command(context, args):
    command = [
        "codex", "exec", "--skip-git-repo-check", "--sandbox", context["mode"],
        "-c", "approval_policy=never", "--cd", context["workdir"],
    ]
    if args.model:
        command.extend(("-m", args.model))
    if args.effort and args.effort != "ultra":
        command.extend(("-c", "model_reasoning_effort=" + args.effort))
    command.extend(("--output-last-message", "{transport_output}", "-"))
    return command, "prompt", "codex-exec", {}


def agy_command(context, args):
    command = [
        "agy", "--dangerously-skip-permissions", "--mode", "accept-edits",
        "--add-dir", context["workdir"], "--model", args.model,
        "--print-timeout", args.print_timeout,
    ]
    command.extend(("-p", "{prompt}"))
    return command, "agy-confirmation", "agy-print", {}


def build(args):
    context, context_path, context_sha256 = context_file(args.context)
    if context.get("provider") != args.provider:
        raise Blocked("attested context provider does not match adapter")
    if context.get("mode") != args.mode:
        raise Blocked("attested context mode does not match adapter argument")
    same_real_path(context["workdir"], args.workdir, "workdir")
    same_real_path(context["prompt_file"], args.prompt_file, "prompt_file")
    require_regular_nofollow(args.prompt_file, "prompt_file")
    if context.get("prompt_evidence") != file_evidence(args.prompt_file, "prompt_file"):
        raise Blocked("attested context prompt_evidence does not match prompt_file")
    expected_model = args.model or None
    expected_effort = args.effort or None
    expected_transport = "codex-exec" if args.provider == "codex" else "agy-print"
    if context.get("requested_model") != expected_model or context.get("requested_effort") != expected_effort:
        raise Blocked("attested context model or effort does not match adapter arguments")
    if context.get("transport") != expected_transport:
        raise Blocked("attested context transport does not match adapter")
    executables, runtime_path, runtime_executables = runtime_plan(context, args.provider)
    bootstrap = args.bootstrap_python
    if bootstrap and os.path.realpath(bootstrap) != executables["python3"]:
        raise Blocked("bootstrap python3 is not the attested runtime entry")
    if args.provider == "codex":
        command, stdin_mode, transport, metadata = codex_command(context, args)
    else:
        if context["mode"] != "workspace-write":
            raise Blocked("AGY accept-edits adapter requires workspace-write context")
        command, stdin_mode, transport, metadata = agy_command(context, args)
    request = {field: context[field] for field in CONTEXT_FIELDS}
    request.update({
        "schema": "dhpk.cli.request.v1", "provider": args.provider,
        "transport": transport, "command": command, "stdin_mode": stdin_mode,
        "requested_model": expected_model, "requested_effort": expected_effort,
        "adapter_metadata": metadata,
        "runtime_path": runtime_path,
        "runtime_source_path": context["runtime_path"],
        "runtime_executables": runtime_executables,
        "attestation": {"context_path": context_path, "context_sha256": context_sha256},
    })
    request["command"][0] = executables[args.provider]
    return request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--context", required=True)
    parser.add_argument("--provider", required=True, choices=("codex", "agy"))
    parser.add_argument("--mode", required=True, choices=("read-only", "workspace-write"))
    parser.add_argument("--workdir", required=True)
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--model", default="")
    parser.add_argument("--effort", default="")
    parser.add_argument("--print-timeout", default="300s")
    parser.add_argument("--bootstrap-python", default="")
    parser.add_argument("--validate-context", action="store_true")
    args = parser.parse_args()
    try:
        if args.validate_context:
            context, _context_path, _context_sha256 = context_file(args.context)
            if context.get("provider") != args.provider:
                raise Blocked("attested context provider does not match adapter")
            executables, _runtime_path, _runtime_evidence = runtime_plan(context, args.provider)
            if not args.bootstrap_python or os.path.realpath(args.bootstrap_python) != executables["python3"]:
                raise Blocked("bootstrap python3 is not the attested runtime entry")
            return 0
        request = build(args)
    except Blocked as error:
        print("dhpk-cli-transport: BLOCKED: %s" % error, file=sys.stderr)
        return 65
    json.dump(request, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
