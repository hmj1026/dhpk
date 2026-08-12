#!/usr/bin/env python3
"""Validate whether an OpenSpec change is implementation-ready.

本腳本位於 adaptive-dev-workflow 技能的 scripts/ 目錄。

Usage:
    python3 scripts/openspec_gate_check.py --change <name>

Generic environment assumptions:
    - OpenSpec artifacts directory: openspec/changes/<change-id>/
    - tasks.md must exist before implementation can begin
    - repo-specific handoff or shortcut rules belong in project pack references,
      not in this generic script
"""

from __future__ import print_function

import argparse
import json
import os
import subprocess
import sys


def extract_json_objects(text):
    decoder = json.JSONDecoder()
    objects = []
    for index, char in enumerate(text):
        if char not in "{[":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[index:])
        except ValueError:
            continue
        if isinstance(parsed, (dict, list)):
            objects.append(parsed)
    return objects


def run_json(cmd, label, required_keys=None):
    try:
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as exc:
        message = exc.output.decode("utf-8", "replace")
        raise RuntimeError("%s failed: %s" % (label, message.strip()))
    except OSError as exc:
        raise RuntimeError("%s could not be executed: %s" % (label, exc))

    text = output.decode("utf-8", "replace")
    parsed_objects = extract_json_objects(text)
    if parsed_objects:
        if required_keys:
            for obj in reversed(parsed_objects):
                if isinstance(obj, dict) and all(key in obj for key in required_keys):
                    return obj
        return parsed_objects[-1]

    preview = text.strip().replace("\n", " ")
    if len(preview) > 240:
        preview = preview[:240] + "..."
    raise RuntimeError("%s did not return valid JSON: %s" % (label, preview))


def artifact_by_id(artifacts, artifact_id):
    for item in artifacts:
        if item.get("id") == artifact_id:
            return item
    return None


def main():
    parser = argparse.ArgumentParser(description="Check OpenSpec implementation gate status")
    parser.add_argument("--change", required=True, help="OpenSpec change name")
    parser.add_argument("--root", default=".", help="Project root path")
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    os.chdir(root)

    status = run_json([
        "openspec",
        "status",
        "--change",
        args.change,
        "--json",
    ], "openspec status", required_keys=["artifacts"])

    apply_info = run_json([
        "openspec",
        "instructions",
        "apply",
        "--change",
        args.change,
        "--json",
    ], "openspec instructions apply", required_keys=["state", "contextFiles"])

    schema = status.get("schemaName", "unknown")
    artifacts = status.get("artifacts", [])
    apply_requires = status.get("applyRequires", [])
    apply_state = apply_info.get("state", "unknown")

    errors = []
    warnings = []

    if apply_state == "blocked":
        errors.append("Apply state is blocked")

    if apply_requires:
        for artifact_id in apply_requires:
            artifact = artifact_by_id(artifacts, artifact_id)
            if artifact is None:
                errors.append("Required artifact missing: %s" % artifact_id)
                continue
            if artifact.get("status") != "done":
                errors.append(
                    "Required artifact not done: %s (status=%s)"
                    % (artifact_id, artifact.get("status", "unknown"))
                )
    else:
        warnings.append("No applyRequires found in status JSON")

    tasks_artifact = artifact_by_id(artifacts, "tasks")
    if tasks_artifact is None:
        errors.append("tasks artifact not found")
    elif tasks_artifact.get("status") != "done":
        errors.append("tasks artifact status is %s (expected done)" % tasks_artifact.get("status"))

    context_files = apply_info.get("contextFiles", [])
    has_tasks_context = any(str(path).endswith("tasks.md") for path in context_files)
    if not has_tasks_context:
        tasks_path = os.path.join(root, "openspec", "changes", args.change, "tasks.md")
        if not os.path.exists(tasks_path):
            errors.append("tasks.md not found in contextFiles or change directory")
        else:
            warnings.append("tasks.md missing in contextFiles; found directly in change directory")

    print("OpenSpec Gate Report")
    print("- Change: %s" % args.change)
    print("- Schema: %s" % schema)
    print("- Apply state: %s" % apply_state)
    print("- applyRequires: %s" % (", ".join(apply_requires) if apply_requires else "(none)"))

    if warnings:
        print("- Warnings:")
        for item in warnings:
            print("  - %s" % item)

    if errors:
        print("- Result: FAIL")
        print("- Errors:")
        for item in errors:
            print("  - %s" % item)
        return 1

    print("- Result: PASS")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as exc:
        print("OpenSpec Gate Report")
        print("- Result: ERROR")
        print("- Message: %s" % exc)
        sys.exit(2)
