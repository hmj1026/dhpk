#!/usr/bin/env bash
# post-obs.sh — POST a claude-mem observation using a temp file (safe for special chars)
#
# Usage: bash scripts/post-obs.sh <payload_json_file>
# Outputs: obs_id (integer string) or "null"
#
# The caller (model) writes the JSON payload to a temp file first,
# then calls this script. Using -d @file avoids shell injection from
# newlines / quotes / metacharacters in handover_context.

PAYLOAD_FILE="$1"
PORT="${CLAUDE_MEM_WORKER_PORT:-37777}"

if [[ -z "$PAYLOAD_FILE" ]]; then
  echo "ERROR: payload file argument required. Usage: post-obs.sh <payload_json_file>"
  exit 1
fi

if [[ ! -f "$PAYLOAD_FILE" ]]; then
  echo "ERROR: payload file not found: $PAYLOAD_FILE"
  exit 1
fi

# Health check — if worker not reachable, return null immediately
if ! HEALTH=$(curl -f -s -m 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null) || [[ -z "$HEALTH" ]]; then
  echo "null"
  exit 0
fi

# Dedup — skip POST if this observation is byte-identical to the last one posted
# under the same change_id. Long opsx-apply-resume sessions Save many times with the
# same L0 headline, which would otherwise spam claude-mem recall with near-duplicate
# rows. Fingerprint = sha256(title + NUL + content); cache keyed by concepts[0].
# An unavailable or unsafe cache disables dedup only; posting still proceeds.
# Pin the shared temp base and an owned private directory before cache access.
# Python is optional here: no cache operation falls back to shell redirection.
cache_observation() {
  command -v python3 >/dev/null 2>&1 || return 0
  python3 - "$@" "${TMPDIR:-/tmp}" 2>/dev/null <<'PY'
import os
import re
import secrets
import stat
import sys


def cache():
    action, key, fingerprint, observation_id, base = sys.argv[1:]
    if not re.fullmatch(r'[0-9a-f]{12}', key):
        return
    if not re.fullmatch(r'[0-9a-f]{64}', fingerprint):
        return
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    base_fd = os.open(base, directory_flags)
    directory_fd = None
    temp_name = None
    try:
        private_name = f'claude-mem-obs-cache-{os.geteuid()}'
        try:
            os.mkdir(private_name, 0o700, dir_fd=base_fd)
        except FileExistsError:
            pass
        directory_fd = os.open(private_name, directory_flags, dir_fd=base_fd)
        info = os.fstat(directory_fd)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            return

        leaf = key + '.txt'
        previous = None
        try:
            # Nonblocking open prevents a hostile FIFO from hanging before fstat.
            fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        else:
            with os.fdopen(fd, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                        or stat.S_IMODE(info.st_mode) != 0o600
                        or info.st_nlink != 1 or info.st_size > 512):
                    return
                raw = stream.read(513)
            if not re.fullmatch(rb'[0-9a-f]{64}\n[0-9]+\n', raw):
                return
            previous = raw.decode('ascii').splitlines()

        if action == 'read':
            if previous and previous[0] == fingerprint:
                print(previous[1])
            return
        if action != 'write' or not re.fullmatch(r'[0-9]+', observation_id):
            return
        temp_name = '.' + key + '-' + secrets.token_hex(16)
        fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory_fd)
        with os.fdopen(fd, 'wb') as stream:
            if stat.S_IMODE(os.fstat(stream.fileno()).st_mode) != 0o600:
                return
            stream.write((fingerprint + '\n' + observation_id + '\n').encode('ascii'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, leaf, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        temp_name = None
    finally:
        if temp_name is not None and directory_fd is not None:
            try:
                os.unlink(temp_name, dir_fd=directory_fd)
            except OSError:
                pass
        if directory_fd is not None:
            os.close(directory_fd)
        os.close(base_fd)


try:
    cache()
except (OSError, ValueError, AttributeError, NotImplementedError):
    pass
PY
  return 0
}

OBS_TITLE=$(jq -r '.title // ""' "$PAYLOAD_FILE" 2>/dev/null)
OBS_CONTENT=$(jq -r '.content // ""' "$PAYLOAD_FILE" 2>/dev/null)
OBS_CONCEPT=$(jq -r '.concepts[0] // "global"' "$PAYLOAD_FILE" 2>/dev/null)
OBS_FP=$(printf '%s\0%s' "$OBS_TITLE" "$OBS_CONTENT" | sha256sum 2>/dev/null | cut -d' ' -f1)
CONCEPT_KEY=$(printf '%s' "$OBS_CONCEPT" | sha256sum 2>/dev/null | cut -c1-12)
PREV_ID=$(cache_observation read "$CONCEPT_KEY" "$OBS_FP" '')
if [[ "$PREV_ID" =~ ^[0-9]+$ ]]; then
  echo "[post-obs] dedup: identical to last observation, skipped" >&2
  echo "$PREV_ID"
  exit 0
fi

RESULT_FILE=$(mktemp "${TMPDIR:-/tmp}/claude-mem-obs-result.XXXXXX") || {
  echo "[post-obs] cannot create a result temp file under ${TMPDIR:-/tmp}" >&2
  echo "null"
  exit 0
}
trap 'rm -f "$RESULT_FILE"' EXIT

if ! curl -f -s -m 5 -X POST "http://127.0.0.1:${PORT}/api/observations" \
  -H "Content-Type: application/json" \
  -d "@${PAYLOAD_FILE}" \
  -o "$RESULT_FILE" 2>/dev/null; then
  echo "null"
  exit 0
fi

OBS_ID=$(jq -r '.id | select(type == "number" and . >= 0 and . == floor) | tostring' "$RESULT_FILE" 2>/dev/null)
if [[ ! "$OBS_ID" =~ ^[0-9]+$ ]]; then
  echo "null"
  exit 0
fi
rm -f "$RESULT_FILE"

# Record only a successful observation in the validated private cache.
if [[ -n "$OBS_FP" ]]; then
  cache_observation write "$CONCEPT_KEY" "$OBS_FP" "$OBS_ID"
fi

echo "$OBS_ID"
