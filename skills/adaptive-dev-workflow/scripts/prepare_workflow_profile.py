#!/usr/bin/env python3
"""Create or update workflow profile for any environment."""

from __future__ import print_function

import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="Prepare workflow profile")
    parser.add_argument("--output", default=".workflow/profile.yaml", help="Profile output path")
    parser.add_argument("--language", required=True, help="Primary language")
    parser.add_argument("--runtime", required=True, help="Runtime or platform")
    parser.add_argument("--current-version", required=True, help="Current version")
    parser.add_argument("--target-version", required=True, help="Target upgrade version")
    parser.add_argument("--architecture", required=True, help="Architecture style")
    parser.add_argument("--test-strategy", required=True, help="Testing strategy")
    parser.add_argument("--style", required=True, help="Style rules summary")
    parser.add_argument("--dependency-policy", required=True, help="Dependency policy summary")
    parser.add_argument("--work-item-system", required=True, help="openspec/docs/other")
    parser.add_argument("--dry-run", action="store_true", help="Print without writing file")
    args = parser.parse_args()

    output_path = os.path.abspath(args.output)
    output_dir = os.path.dirname(output_path)

    content = """language: \"{language}\"
runtime: \"{runtime}\"
current_version: \"{current_version}\"
target_upgrade_version: \"{target_version}\"
architecture_style: \"{architecture}\"
test_strategy: \"{test_strategy}\"
style_rules: \"{style}\"
dependency_policy: \"{dependency_policy}\"
work_item_system: \"{work_item_system}\"
""".format(
        language=args.language,
        runtime=args.runtime,
        current_version=args.current_version,
        target_version=args.target_version,
        architecture=args.architecture,
        test_strategy=args.test_strategy,
        style=args.style,
        dependency_policy=args.dependency_policy,
        work_item_system=args.work_item_system,
    )

    print("Workflow profile preview")
    print(content.rstrip())

    if args.dry_run:
        print("Mode: dry-run (no file written)")
        return 0

    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)

    with open(output_path, "w") as handle:
        handle.write(content)

    print("Profile written: %s" % output_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
