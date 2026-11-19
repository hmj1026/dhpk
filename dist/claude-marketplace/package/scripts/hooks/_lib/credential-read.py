#!/usr/bin/env python3
"""Fail-closed entrypoint for the Bash credential-read gate."""
import json
import os
import sys

from credential_policy import analyze, validate_patterns
import credential_verdict as verdict


FAILURES = (ValueError, TypeError, OSError, RecursionError)


def decide():
    # 每一步都要落在同一組例外內；深度巢狀的 JSON 會丟出 RecursionError。
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict) or not isinstance(payload.get('tool_input'), dict):
            return verdict.inspection_failure('payload')
        command = payload['tool_input'].get('command')
        if not isinstance(command, str):
            return verdict.inspection_failure('payload')
    except FAILURES:
        return verdict.inspection_failure('payload')
    try:
        if os.environ.get('DHPK_CREDENTIAL_CONFIG_ERROR') == '1':
            return verdict.inspection_failure('policy')
        patterns = validate_patterns(json.loads(os.environ.get('CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS', '[]')))
    except FAILURES:
        return verdict.inspection_failure('policy')
    try:
        return analyze(command, patterns, os.getcwd())
    except FAILURES as error:
        # 只回報例外類型；例外訊息可能含有路徑或指令內容。
        return verdict.inspection_failure(type(error).__name__)


def main():
    result = decide()
    if result.allowed:
        return 0
    print('[bash-guard] blocked: %s' % result.message(), file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
