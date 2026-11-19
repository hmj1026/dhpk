#!/usr/bin/env python3
"""Generic workflow gate check for tool-agnostic delivery."""

from __future__ import print_function

import argparse
import os
import re
import sys


WORKFLOW_TYPE_ALIASES = {
    "feature": "feature",
    "feature-delivery": "feature",
    "feature_delivery": "feature",
    "bugfix": "bugfix",
    "bug-fix": "bugfix",
    "bug_fix": "bugfix",
    "bug": "bugfix",
    "lightweight": "lightweight",
    "lightweight-maintenance": "lightweight",
    "lightweight_maintenance": "lightweight",
}


def read_text(path):
    with open(path, "r") as handle:
        return handle.read()


def parse_work_item_system(profile_text):
    match = re.search(r'^work_item_system:\s*"?([^"\n]+)"?', profile_text, re.MULTILINE)
    if not match:
        return None
    return match.group(1).strip().lower()


def has_required_profile_keys(profile_text):
    required = [
        "language",
        "runtime",
        "current_version",
        "target_upgrade_version",
        "architecture_style",
        "test_strategy",
        "style_rules",
        "dependency_policy",
        "work_item_system",
    ]
    missing = []
    for key in required:
        if not re.search(r"^%s:\s*.+$" % re.escape(key), profile_text, re.MULTILINE):
            missing.append(key)
    return missing


def normalize_workflow_type(raw_value):
    workflow_type = WORKFLOW_TYPE_ALIASES.get((raw_value or "").strip().lower())
    if workflow_type:
        return workflow_type
    return None


def main():
    parser = argparse.ArgumentParser(description="Generic workflow gate check")
    parser.add_argument("--profile", default=".workflow/profile.yaml", help="Workflow profile path")
    parser.add_argument(
        "--workflow-type",
        default="feature",
        help="feature / bugfix / lightweight",
    )
    parser.add_argument("--work-item", help="Work-item path or id")
    parser.add_argument("--legacy-reference", help="Legacy reference path")
    parser.add_argument("--red-proof", help="Path to evidence text proving failing test first")
    args = parser.parse_args()

    errors = []
    warnings = []
    notes = []
    workflow_type = normalize_workflow_type(args.workflow_type)
    if not workflow_type:
        print("Workflow Gate Report")
        print("- Result: FAIL")
        print("- Errors:")
        print("  - unsupported workflow type: %s" % args.workflow_type)
        return 1

    requires_profile = workflow_type == "feature"
    requires_work_item = workflow_type in ["feature", "bugfix"]
    requires_legacy_reference = workflow_type in ["feature", "bugfix"]
    requires_red_proof = workflow_type in ["feature", "bugfix"]
    lightweight_mode = workflow_type == "lightweight"

    if lightweight_mode:
        notes.append("lightweight workflow skips profile/work-item/legacy/RED gate; keep targeted verification separately")

    profile_path = os.path.abspath(args.profile)
    if not os.path.exists(profile_path):
        if requires_profile:
            errors.append("workflow profile not found: %s" % profile_path)
        elif not lightweight_mode:
            warnings.append("workflow profile not found: %s" % profile_path)
        profile_text = ""
        work_item_system = None
    else:
        profile_text = read_text(profile_path)
        missing_keys = has_required_profile_keys(profile_text)
        if missing_keys and requires_profile:
            errors.append("profile missing keys: %s" % ", ".join(missing_keys))
        elif missing_keys:
            warnings.append("profile missing keys: %s" % ", ".join(missing_keys))
        work_item_system = parse_work_item_system(profile_text)
        if not work_item_system and requires_profile:
            errors.append("work_item_system is missing or empty in profile")
        elif not work_item_system:
            warnings.append("work_item_system is missing or empty in profile")

    if args.work_item:
        if not os.path.exists(args.work_item):
            warnings.append("work-item path not found (if id-based system, ignore): %s" % args.work_item)
    elif requires_work_item:
        errors.append("--work-item is required for workflow type: %s" % workflow_type)
    elif not lightweight_mode:
        warnings.append("--work-item not provided")

    if args.legacy_reference:
        if not os.path.exists(args.legacy_reference):
            if requires_legacy_reference:
                errors.append("legacy reference not found: %s" % args.legacy_reference)
            else:
                warnings.append("legacy reference not found: %s" % args.legacy_reference)
    elif requires_legacy_reference:
        errors.append("--legacy-reference is required for workflow type: %s" % workflow_type)
    elif not lightweight_mode:
        warnings.append("--legacy-reference not provided")

    if args.red_proof:
        if not os.path.exists(args.red_proof):
            if requires_red_proof:
                errors.append("red-proof file not found: %s" % args.red_proof)
            else:
                warnings.append("red-proof file not found: %s" % args.red_proof)
    elif requires_red_proof:
        errors.append("--red-proof is required for workflow type: %s" % workflow_type)
    elif not lightweight_mode:
        warnings.append("--red-proof not provided (cannot auto-verify RED->GREEN evidence)")

    print("Workflow Gate Report")
    print("- Profile: %s" % profile_path)
    print("- Workflow type: %s" % workflow_type)
    print("- Work-item system: %s" % (work_item_system or "unknown"))

    if notes:
        print("- Notes:")
        for item in notes:
            print("  - %s" % item)

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
    sys.exit(main())
