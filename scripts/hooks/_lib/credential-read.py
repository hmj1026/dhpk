#!/usr/bin/env python3
"""Fail-closed entrypoint for the Bash credential-read gate."""
import json
import os
import sys

from credential_policy import analyze, validate_patterns


def main():
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict) or not isinstance(payload.get('tool_input'), dict):
            raise ValueError('payload')
        command = payload['tool_input'].get('command')
        if not isinstance(command, str):
            raise ValueError('payload')
        if os.environ.get('DHPK_CREDENTIAL_CONFIG_ERROR') == '1':
            raise ValueError('policy')
        patterns = validate_patterns(json.loads(os.environ.get('CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS', '[]')))
        if analyze(command, patterns, os.getcwd()):
            raise ValueError('protected read')
    except (ValueError, TypeError, OSError, RecursionError):
        print('[bash-guard] blocked: credential read or invalid inspection policy; use controlled extraction or provide non-secret information.', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
