#!/usr/bin/env bash
# write-handoff.sh — atomically write one explicit Save handoff from stdin
#
# Usage: bash scripts/write-handoff.sh <handoff-file>
#
# The path is opened and traversed by the embedded Python writer. The payload
# stays on file descriptor 3 because Python's standard input carries this
# program through the here-document. A missing Python capability is an explicit
# non-pass; there is no shell fallback for this boundary.

if (( $# != 1 )); then
  echo "ERROR: exactly one explicit handoff path is required" >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: required Python3 capability is unavailable; handoff was not written" >&2
  exit 2
fi

# Preserve the caller's complete stdin payload before the here-document feeds
# the embedded Python program on stdin.
exec 3<&0
python3 - "$1" 3<&3 <<'PY'
import errno
import os
import secrets
import stat
import sys


class HandoffError(Exception):
    """A caller-visible, fail-closed handoff write error."""


def reject(message):
    raise HandoffError(message)


def required_flag(name):
    value = getattr(os, name, None)
    if value is None:
        reject(f"Python capability {name} is unavailable; handoff was not written")
    return value


O_DIRECTORY = required_flag('O_DIRECTORY')
O_NOFOLLOW = required_flag('O_NOFOLLOW')
DIRECTORY_FLAGS = os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW
CREATE_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | O_NOFOLLOW
PAYLOAD_FD = 3
CHUNK_SIZE = 1024 * 1024


def target_components(raw):
    if not isinstance(raw, str) or raw == '':
        reject('handoff path must be a non-empty explicit path')
    if raw.startswith('-'):
        reject('handoff path must not begin with an option marker')
    if '\x00' in raw:
        reject('handoff path must not contain NUL')
    absolute = raw.startswith('/')
    if absolute:
        if raw == '/':
            reject('handoff path must name a file below the selected root')
        components = raw.split('/')[1:]
    else:
        components = raw.split('/')
    if not components or any(component in ('', '.', '..') for component in components):
        reject('handoff path must contain regular path components only')
    return absolute, components


def open_parent(absolute, components):
    # Pin the selected root first. Every later operation uses a descriptor
    # relative to this chain, so a path race cannot redirect the write.
    root = '/' if absolute else '.'
    try:
        current = os.open(root, DIRECTORY_FLAGS)
    except OSError as error:
        reject(f'cannot open handoff root {root!r}: {error}')

    try:
        for component in components[:-1]:
            try:
                child = os.open(component, DIRECTORY_FLAGS, dir_fd=current)
            except FileNotFoundError:
                try:
                    os.mkdir(component, 0o700, dir_fd=current)
                except FileExistsError:
                    pass
                try:
                    child = os.open(component, DIRECTORY_FLAGS, dir_fd=current)
                except OSError as error:
                    if error.errno in (errno.ELOOP, errno.ENOTDIR):
                        reject(f'handoff path has a symlinked ancestor: {component}')
                    reject(f'cannot open handoff ancestor {component!r}: {error}')
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    reject(f'handoff path has a symlinked ancestor: {component}')
                reject(f'cannot open handoff ancestor {component!r}: {error}')
            os.close(current)
            current = child
        return current
    except Exception:
        os.close(current)
        raise


def existing_leaf_identity(parent_fd, leaf):
    try:
        info = os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(info.st_mode):
        reject(f'handoff destination must not be a symlink: {leaf}')
    if not stat.S_ISREG(info.st_mode):
        reject(f'handoff destination must be a regular file: {leaf}')
    return (info.st_dev, info.st_ino)


def create_temp(parent_fd, leaf):
    for _ in range(32):
        name = f'.{leaf}.tmp-{os.getpid()}-{secrets.token_hex(16)}'
        try:
            fd = os.open(name, CREATE_FLAGS, 0o600, dir_fd=parent_fd)
            return name, fd
        except FileExistsError:
            continue
    reject('could not allocate a private handoff temporary file')


def copy_payload(temp_fd):
    while True:
        chunk = os.read(PAYLOAD_FD, CHUNK_SIZE)
        if not chunk:
            break
        view = memoryview(chunk)
        while view:
            written = os.write(temp_fd, view)
            if written <= 0:
                reject('handoff payload write made no progress')
            view = view[written:]
    os.fsync(temp_fd)


def write_handoff(raw_target):
    absolute, components = target_components(raw_target)
    leaf = components[-1]
    parent_fd = open_parent(absolute, components)
    temp_name = None
    temp_fd = None
    try:
        before = existing_leaf_identity(parent_fd, leaf)
        temp_name, temp_fd = create_temp(parent_fd, leaf)
        copy_payload(temp_fd)
        os.close(temp_fd)
        temp_fd = None

        after = existing_leaf_identity(parent_fd, leaf)
        if before is None:
            if after is not None:
                reject(f'handoff destination appeared during write: {leaf}')
        elif after != before:
            reject(f'handoff destination changed during write: {leaf}')

        os.replace(temp_name, leaf, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        temp_name = None
        os.fsync(parent_fd)
    finally:
        if temp_fd is not None:
            try:
                os.close(temp_fd)
            except OSError:
                pass
        if temp_name is not None:
            try:
                os.unlink(temp_name, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
        try:
            os.close(parent_fd)
        finally:
            try:
                os.close(PAYLOAD_FD)
            except OSError:
                pass


def main():
    if len(sys.argv) != 2:
        reject('exactly one explicit handoff path is required')
    write_handoff(sys.argv[1])
    print(f'handoff written: {sys.argv[1]}')


try:
    main()
except HandoffError as error:
    print(f'ERROR: {error}', file=sys.stderr)
    raise SystemExit(2)
except OSError as error:
    print(f'ERROR: handoff write failed: {error}', file=sys.stderr)
    raise SystemExit(2)
PY
status=$?
exec 3<&-
exit "$status"
