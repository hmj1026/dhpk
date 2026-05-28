#!/usr/bin/env python3
"""Prepare change-scoped helper docs and legacy backup snippet."""

from __future__ import print_function

import argparse
import datetime
import os
import sys


def write_file(path, content, dry_run):
    if dry_run:
        return
    with open(path, "w") as handle:
        handle.write(content)


def infer_test_hints(paths):
    # Test hints are project-specific. The generic skill returns none; projects
    # declare their own path->test heuristics in .claude/rules/dev-workflow-project.md.
    # When empty, the caller falls back to a generic "add targeted test hints" line.
    return []


def resolve_change_dir(root, change, work_item_system, change_dir_arg):
    if change_dir_arg:
        if os.path.isabs(change_dir_arg):
            return change_dir_arg, True
        return os.path.join(root, change_dir_arg), True

    if work_item_system == "openspec":
        return os.path.join(root, "openspec", "changes", change), False

    return os.path.join(root, ".workflow", "changes", change), True


def ensure_seed_file(path, content, dry_run):
    if os.path.exists(path):
        return "keep"
    write_file(path, content, dry_run)
    return "create"


def main():
    parser = argparse.ArgumentParser(description="Prepare change-scoped dev helper files")
    parser.add_argument("--change", required=True, help="Work-item change name")
    parser.add_argument("--ticket", default="TBD", help="Ticket id or reference")
    parser.add_argument("--reason", required=True, help="Reason for this change")
    parser.add_argument("--path", action="append", default=[], help="Impacted path (repeatable)")
    parser.add_argument("--work-item-system", default="openspec", help="openspec/docs/other")
    parser.add_argument("--change-dir", help="Override work-item change directory path")
    parser.add_argument("--root", default=".", help="Project root path")
    parser.add_argument("--dry-run", action="store_true", help="Print output without writing files")
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    work_item_system = args.work_item_system.strip().lower()
    if work_item_system not in ["openspec", "docs", "other"]:
        print("Error: unsupported --work-item-system: %s" % args.work_item_system)
        return 1

    change_dir, allow_create_change_dir = resolve_change_dir(
        root=root,
        change=args.change,
        work_item_system=work_item_system,
        change_dir_arg=args.change_dir,
    )
    change_dir = os.path.abspath(change_dir)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    openspec_gate_script = os.path.join(script_dir, "openspec_gate_check.py")

    if not os.path.isdir(change_dir):
        if allow_create_change_dir:
            if not args.dry_run:
                os.makedirs(change_dir)
            action_change_dir = "create"
        else:
            print("Error: change directory not found: %s" % change_dir)
            return 1
    else:
        action_change_dir = "use"

    if work_item_system != "openspec":
        proposal_path = os.path.join(change_dir, "proposal.md")
        tasks_path = os.path.join(change_dir, "tasks.md")
        notes_path = os.path.join(change_dir, "implementation-notes.md")
        action_proposal = ensure_seed_file(
            proposal_path,
            "# Proposal\n\n## Context\n\n- TBD\n\n## Goals\n\n- TBD\n\n## Non-Goals\n\n- TBD\n",
            args.dry_run,
        )
        action_tasks = ensure_seed_file(
            tasks_path,
            "# Tasks\n\n- [ ] TBD\n",
            args.dry_run,
        )
        action_notes = ensure_seed_file(
            notes_path,
            "# Implementation Notes\n\n## Decisions\n\n- TBD\n\n## Verification\n\n- TBD\n",
            args.dry_run,
        )
    else:
        proposal_path = None
        tasks_path = None
        notes_path = None
        action_proposal = None
        action_tasks = None
        action_notes = None

    today = datetime.date.today().isoformat()

    legacy_reference_path = os.path.join(change_dir, "legacy-reference.md")
    if not os.path.exists(legacy_reference_path):
        legacy_content = """# Legacy Reference\n\n## Change Context\n\n- Date: {date}\n- Ticket: {ticket}\n- Reason: {reason}\n\n## Legacy Blocks\n\n| File | Legacy Block Marker | Summary |\n|------|----------------------|---------|\n| TBD  | `LEGACY_BACKUP_START/END` | TBD |\n\n## Replacement Notes\n\n- Why legacy logic is replaced:\n- Expected behavior after refactor/fix:\n- Rollback cue:\n""".format(
            date=today,
            ticket=args.ticket,
            reason=args.reason,
        )
        write_file(legacy_reference_path, legacy_content, args.dry_run)
        action_legacy = "create"
    else:
        action_legacy = "keep"

    dev_scope_path = os.path.join(change_dir, "dev-scope.md")
    impacted_paths = args.path
    test_hints = infer_test_hints(impacted_paths)

    lines = [
        "# Dev Scope",
        "",
        "## Meta",
        "",
        "- Date: %s" % today,
        "- Ticket: %s" % args.ticket,
        "- Reason: %s" % args.reason,
        "",
        "## Impacted Paths",
        "",
    ]

    if impacted_paths:
        for item in impacted_paths:
            lines.append("- `%s`" % item)
    else:
        lines.append("- TBD")

    lines.extend([
        "",
        "## Test Hints",
        "",
    ])

    if test_hints:
        for item in test_hints:
            lines.append("- %s" % item)
    else:
        lines.append("- Add targeted test hints based on impacted paths")

    if work_item_system == "openspec":
        lines.extend([
            "",
            "## OpenSpec Gate",
            "",
            "- Run: `python3 %s --change %s`" % (openspec_gate_script, args.change),
        ])
    else:
        lines.extend([
            "",
            "## Work-Item Gate (Generic Docs)",
            "",
            "- Verify proposal exists: `%s`" % proposal_path,
            "- Verify tasks exists and actionable: `%s`" % tasks_path,
            "- Verify implementation notes exists: `%s`" % notes_path,
        ])

    write_file(dev_scope_path, "\n".join(lines) + "\n", args.dry_run)

    snippet = """// LEGACY_BACKUP_START {date}: {reason} (ticket: {ticket})
// 舊邏輯摘要
// ... old code block ...
// LEGACY_BACKUP_END""".format(
        date=today,
        reason=args.reason,
        ticket=args.ticket,
    )

    print("Prepared change scope")
    print("- Change: %s" % args.change)
    print("- Work-item system: %s" % work_item_system)
    print("- change directory: %s (%s)" % (change_dir, action_change_dir))
    print("- legacy-reference.md: %s (%s)" % (legacy_reference_path, action_legacy))
    print("- dev-scope.md: %s (create/update)" % dev_scope_path)
    if work_item_system != "openspec":
        print("- proposal.md: %s (%s)" % (proposal_path, action_proposal))
        print("- tasks.md: %s (%s)" % (tasks_path, action_tasks))
        print("- implementation-notes.md: %s (%s)" % (notes_path, action_notes))
    print("- In-code legacy snippet:")
    print(snippet)

    if args.dry_run:
        print("- Mode: dry-run (no file written)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
