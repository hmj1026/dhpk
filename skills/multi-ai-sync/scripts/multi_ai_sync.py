#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Claude-first multi-platform sync planner entrypoint."""

import sys

sys.dont_write_bytecode = True

from multi_ai_sync_lib.cli import main


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
