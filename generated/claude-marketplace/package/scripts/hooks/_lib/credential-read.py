#!/usr/bin/env python3
"""Fail-closed entrypoint for the Bash credential-read gate."""
import json
import os
import sys

from credential_policy import PROTECTED, RECURSIVE, UNSUPPORTED, analyze, validate_patterns

DEFAULT_HINT = 'use controlled extraction or provide non-secret information.'
HINTS = {
    PROTECTED: DEFAULT_HINT,
    # 避免假設 Host 一定提供 Grep/Read，並區分兩個搜尋工具的排除語法。
    UNSUPPORTED: 'rewrite with supported options and explicit non-protected files; for recursive rg use --glob "!pattern", for grep use --exclude="pattern" for every default and custom credential pattern; Grep/Read may be used if available.',
    RECURSIVE: 'exclude every default and custom credential pattern: for rg use --glob "!pattern", for grep use --exclude="pattern"; or target explicit non-protected files. Grep/Read may be used if available.',
}


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
        reason = analyze(command, patterns, os.getcwd())
        if reason:
            raise ValueError(reason)
    except (ValueError, TypeError, OSError, RecursionError) as error:
        # 掃描原因會附加命中資訊；仍沿用遞迴讀取的恢復指引。
        hint = HINTS[RECURSIVE] if str(error).startswith(RECURSIVE) else HINTS.get(str(error), DEFAULT_HINT)
        print('[bash-guard] blocked: %s; %s' % (error, hint), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
