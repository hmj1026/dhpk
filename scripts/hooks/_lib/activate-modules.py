#!/usr/bin/env python3
"""Parse and validate dhpk module activation for the session-start hook.

Extracted from the inline HERE-DOC that session-start.sh used to embed, so the
logic is unit-testable in isolation. Reads the comma-separated module list,
dedups preserving declaration order, checks each module directory exists under
<plugin_root>/modules/, parses module.yaml for display_name + requires, and
validates each module's requires against the declared set.

Emits a tab-separated protocol on stdout for the bash caller to route:

    WARN\t<message>            -> caller prints to stderr with a [session-start] prefix
    MODULE\t<name>\t<display>  -> caller adds to the "module enabled" summary
    ACTIVE\t<csv>              -> caller sets/exports DHPK_ACTIVE_MODULES

The caller keeps the export in the parent shell (a child process cannot set it).

Protocol invariant: field values (message / name / display) must not contain a
literal tab — the bash reader (`IFS=$'\t' read`) splits on tab. Today every value
derives from CSV-split + str.strip() module names and os.path.join paths, none of
which can contain a tab, so the single-tab-per-field assumption holds.

Usage: activate-modules.py <plugin_root> <modules_csv>
"""
import os
import sys


def parse_yaml(path):
    """Return (display_name, [requires]) from a module.yaml.

    Minimal top-level parser mirroring the historical inline version: only
    `display_name:` and `requires: [a, b]` lines are read; values may be single-
    or double-quoted. Anything unreadable yields ("", []).
    """
    display = ""
    requires = []
    try:
        with open(path) as f:
            text = f.read()
    except OSError:
        return display, requires
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("display_name:"):
            display = line.split(":", 1)[1].strip().strip('"').strip("'")
        elif line.startswith("requires:"):
            v = line.split(":", 1)[1].strip()
            if v.startswith("[") and v.endswith("]"):
                inner = v[1:-1].strip()
                if inner:
                    requires = [x.strip().strip('"').strip("'") for x in inner.split(",")]
    return display, requires


def activate(plugin_root, raw):
    """Compute the activation protocol lines for a raw module CSV."""
    enabled = []
    for part in raw.split(","):
        m = part.strip()
        if m and m not in enabled:
            enabled.append(m)

    lines = []
    active = []
    for m in enabled:
        mdir = os.path.join(plugin_root, "modules", m)
        if not os.path.isdir(mdir):
            lines.append("WARN\tmodule '%s' not found at %s" % (m, mdir))
            continue
        display, requires = parse_yaml(os.path.join(mdir, "module.yaml"))
        if not display:
            display = m
        lines.append("MODULE\t%s\t%s" % (m, display))
        for req in requires:
            if req not in enabled:
                lines.append(
                    "WARN\tmodule '%s' requires '%s' but it is not enabled" % (m, req)
                )
        active.append(m)

    lines.append("ACTIVE\t%s" % ",".join(active))
    return lines


def main(argv):
    if len(argv) < 3:
        return 0
    sys.stdout.write("\n".join(activate(argv[1], argv[2])) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
