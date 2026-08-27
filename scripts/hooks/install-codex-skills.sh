#!/usr/bin/env bash
# install-codex-skills.sh — safely sync the plugin's codex/ tree into a
# project's .codex/ directory.
#
# Usage:
#   install-codex-skills.sh                  symlink mode
#   install-codex-skills.sh --copy           materialise regular files
#   install-codex-skills.sh --update         reconcile an existing receipt
#   install-codex-skills.sh --migrate        adopt exact legacy destinations
#   install-codex-skills.sh --plan --json    report reconciliation evidence without writing
#   install-codex-skills.sh --adopt <path>@<destination-fingerprint>@<source-fingerprint> explicitly adopt one reported collision
#   install-codex-skills.sh --profile <id>    select an inventory-owned capability profile
#   install-codex-skills.sh --skill <stable-id> repeat an additive stable-ID overlay
#   install-codex-skills.sh --uninstall       remove unchanged owned entries
#   install-codex-skills.sh --force          bypass project-root heuristic
#
# The receipt is schema-versioned and records every managed skill, agent, and
# supporting asset.  The embedded Python program is deliberately static: all
# filesystem paths arrive through environment variables so apostrophes and
# other valid path characters cannot become generated Python syntax.
# The retained project-local Codex sync route defaults to compat-v1; use
# --profile minimal for an explicit profile migration.

set -euo pipefail

MODE="symlink"
MODE_EXPLICIT=0
UPDATE=0
FORCE=0
MIGRATE=0
UNINSTALL=0
PLAN=0
JSON_OUTPUT=0
ADOPT_PATHS=""
PROFILE_ID=""
PROFILE_EXPLICIT=0
SKILL_IDS=""
while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
        --copy) MODE="copy"; MODE_EXPLICIT=1 ;;
        --update) UPDATE=1 ;;
        --migrate) MIGRATE=1 ;;
        --uninstall) UNINSTALL=1 ;;
        --plan) PLAN=1 ;;
        --json) JSON_OUTPUT=1 ;;
        --profile)
            shift
            if [ "$#" -eq 0 ] || [[ "$1" == --* ]]; then
                echo "[${DHPK_INSTALLER_NAME:-install-codex-skills}] --profile requires a value" >&2
                exit 2
            fi
            PROFILE_ID="$1"
            PROFILE_EXPLICIT=1
            ;;
        --profile=*)
            PROFILE_ID="${arg#--profile=}"
            if [ -z "$PROFILE_ID" ]; then
                echo "[${DHPK_INSTALLER_NAME:-install-codex-skills}] --profile requires a value" >&2
                exit 2
            fi
            PROFILE_EXPLICIT=1
            ;;
        --skill)
            shift
            if [ "$#" -eq 0 ] || [[ "$1" == --* ]]; then
                echo "[${DHPK_INSTALLER_NAME:-install-codex-skills}] --skill requires a stable ID" >&2
                exit 2
            fi
            SKILL_IDS="${SKILL_IDS}${1}"$'\n'
            ;;
        --skill=*)
            if [ -z "${arg#--skill=}" ]; then
                echo "[${DHPK_INSTALLER_NAME:-install-codex-skills}] --skill requires a stable ID" >&2
                exit 2
            fi
            SKILL_IDS="${SKILL_IDS}${arg#--skill=}"$'\n'
            ;;
        --adopt)
            shift
            if [ "$#" -eq 0 ]; then
                echo "[${DHPK_INSTALLER_NAME:-install-codex-skills}] --adopt requires a relative path" >&2
                exit 2
            fi
            ADOPT_PATHS="${ADOPT_PATHS}${1}"$'\n'
            ;;
        --adopt=*) ADOPT_PATHS="${ADOPT_PATHS}${arg#--adopt=}"$'\n' ;;
        --force) FORCE=1 ;;
        --help|-h)
            sed -n '2,15p' "$0"
            exit 0 ;;
        *) echo "[${DHPK_INSTALLER_NAME:-install-codex-skills}] unknown arg: $arg" >&2; exit 2 ;;
    esac
    shift
done

if [ "$PLAN" -eq 1 ] && [ -n "$ADOPT_PATHS" ]; then
    echo "[${DHPK_INSTALLER_NAME:-install-codex-skills}] ERROR: --plan cannot be combined with --adopt" >&2
    exit 2
fi

INSTALLER_NAME="${DHPK_INSTALLER_NAME:-install-codex-skills}"
SRC_REL="${DHPK_SRC_REL:-codex}"
DEST_REL="${DHPK_DEST_REL:-.codex}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
CODEX_SRC="$PLUGIN_ROOT/$SRC_REL"
PROJECT_ROOT="$(pwd)"

if [ ! -d "$CODEX_SRC" ]; then
    echo "[$INSTALLER_NAME] ERROR: plugin $SRC_REL/ source not found" >&2
    exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "[$INSTALLER_NAME] ERROR: python3 is required for receipt reconciliation" >&2
    exit 2
fi

if [ "$FORCE" -ne 1 ] && [ "$UNINSTALL" -ne 1 ]; then
    if [ ! -e "$PROJECT_ROOT/.git" ] && [ ! -e "$PROJECT_ROOT/.claude" ] && \
       [ ! -e "$PROJECT_ROOT/.codex" ] && [ ! -e "$PROJECT_ROOT/.cursor" ] && \
       [ ! -e "$PROJECT_ROOT/package.json" ] && [ ! -e "$PROJECT_ROOT/composer.json" ]; then
        echo "[$INSTALLER_NAME] ERROR: '$PROJECT_ROOT' does not look like a project root." >&2
        echo "[$INSTALLER_NAME] Re-run with --force to bypass this check." >&2
        exit 2
    fi
fi

if [ "${DHPK_HARNESS_KIND:-codex}" = "codex" ] && ! command -v codex >/dev/null 2>&1 && [ "$UNINSTALL" -ne 1 ]; then
    echo "[$INSTALLER_NAME] note: 'codex' CLI not found on PATH; files can still be synced." >&2
fi

export DHPK_HARNESS_KIND="${DHPK_HARNESS_KIND:-codex}"
export DHPK_SRC_REL="$SRC_REL"
export DHPK_DEST_REL="$DEST_REL"
export DHPK_SOURCE_KINDS="${DHPK_SOURCE_KINDS:-skills,agents}"
export DHPK_INSTALLER_NAME="$INSTALLER_NAME"
export DHPK_PLUGIN_ROOT="$PLUGIN_ROOT"
export DHPK_INSTALLER_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export DHPK_PROJECT_ROOT="$PROJECT_ROOT"
export DHPK_MODE="$MODE"
export DHPK_MODE_EXPLICIT="$MODE_EXPLICIT"
export DHPK_UPDATE="$UPDATE"
export DHPK_MIGRATE="$MIGRATE"
export DHPK_UNINSTALL="$UNINSTALL"
export DHPK_PLAN="$PLAN"
export DHPK_JSON_OUTPUT="$JSON_OUTPUT"
export DHPK_ADOPT_PATHS="$ADOPT_PATHS"
export DHPK_PROFILE_ID="$PROFILE_ID"
export DHPK_PROFILE_EXPLICIT="$PROFILE_EXPLICIT"
export DHPK_SKILL_IDS="$SKILL_IDS"

python3 - <<'PY'
import datetime
import atexit
import fcntl
import hashlib
import json
import math
import os
import re
import shutil
import stat
import sys
import uuid

PLUGIN_ROOT = os.environ['DHPK_PLUGIN_ROOT']
INSTALLER_ROOT = os.environ.get('DHPK_INSTALLER_ROOT', PLUGIN_ROOT)
PROJECT_ROOT = os.environ['DHPK_PROJECT_ROOT']
HARNESS_KIND = os.environ.get('DHPK_HARNESS_KIND', 'codex')
SRC_REL = os.environ.get('DHPK_SRC_REL', 'codex')
DEST_REL = os.environ.get('DHPK_DEST_REL', '.codex')
SOURCE_KINDS = tuple(kind.strip() for kind in os.environ.get('DHPK_SOURCE_KINDS', 'skills,agents').split(',') if kind.strip())
MANAGED_KINDS = SOURCE_KINDS + ('supporting_assets',)
INSTALLER_NAME = os.environ.get('DHPK_INSTALLER_NAME', 'install-codex-skills')
INSTALLER_SCRIPT = f'scripts/hooks/{INSTALLER_NAME}.sh'
_print = print
def print(*args, **kwargs):
    if args and isinstance(args[0], str):
        args = (args[0].replace('[install-codex-skills]', f'[{INSTALLER_NAME}]'),) + args[1:]
    _print(*args, **kwargs)
CODEX_SRC = os.path.join(PLUGIN_ROOT, SRC_REL)
CODEX_ROOT = os.path.join(PROJECT_ROOT, DEST_REL)
MANIFEST = os.path.join(CODEX_ROOT, '.dhpk-installed.json')
MODE = os.environ.get('DHPK_MODE', 'symlink')
MODE_EXPLICIT = os.environ.get('DHPK_MODE_EXPLICIT') == '1'
UPDATE = os.environ.get('DHPK_UPDATE') == '1'
MIGRATE = os.environ.get('DHPK_MIGRATE') == '1'
UNINSTALL = os.environ.get('DHPK_UNINSTALL') == '1'
PLAN = os.environ.get('DHPK_PLAN') == '1'
JSON_OUTPUT = os.environ.get('DHPK_JSON_OUTPUT') == '1'
ADOPT_PATHS = [path for path in os.environ.get('DHPK_ADOPT_PATHS', '').splitlines() if path]
REQUESTED_PROFILE_ID = os.environ.get('DHPK_PROFILE_ID', '').strip() or None
PROFILE_EXPLICIT = os.environ.get('DHPK_PROFILE_EXPLICIT') == '1'
REQUESTED_SKILL_IDS = [value for value in os.environ.get('DHPK_SKILL_IDS', '').splitlines() if value]
# Test-only fault injection lets the reconciliation suite exercise the
# receipt-failure rollback path without relying on host permissions.
FAIL_RECEIPT_FOR_TEST = os.environ.get('DHPK_TEST_FAIL_RECEIPT') == '1'
FAIL_UNINSTALL_RECEIPT_FSYNC_FOR_TEST = os.environ.get('DHPK_TEST_FAIL_UNINSTALL_RECEIPT_FSYNC') == '1'
ABORT_ADOPTION_PHASE_FOR_TEST = os.environ.get('DHPK_TEST_ABORT_ADOPTION_PHASE')
SCHEMA_VERSION = 3
BACKUP_DIR = '.dhpk-backups'
BACKUP_RUN = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + f'-{os.getpid()}'

# These collections are populated by the reconciliation pass and persisted in
# the receipt as durable evidence. Paths are always relative to the project or
# `.codex` root so a receipt remains useful after a checkout moves.
evidence_paths = {
    'created': [],
    'updated': [],
    'adopted': [],
    'migrated': [],
    'retired': [],
    'collisions': [],
    'deferred': [],
    'orphaned': [],
}
evidence_ownership = {}
backup_records = []
pending_prunes = []
pending_mutations = []
pending_adoptions = []
TRANSACTION_JOURNAL = None
TRANSACTION_RECEIPT_FINAL = True
INSTALL_LOCK_FD = None

# Selection is resolved before source discovery and is carried into every
# receipt.  The installer deliberately keeps this small Python mirror of the
# inventory-owned contract because project-local sync must remain usable on
# hosts that have Python but no Node runtime.  It does not mutate the profile
# manifest; it only derives a frozen per-run selection and filters the
# physical surface projection.
SELECTION_PROFILE_ID = None
SELECTION_COMPATIBILITY = None
SELECTION_POLICY_VERSION = None
SELECTION_CANONICAL_IDS = None
SELECTION_EMITTED_IDS = None
SELECTION_FINGERPRINT = None
SELECTION_SURFACE_FINGERPRINT = None
SELECTION_MIGRATION = None


def record_path(kind, relative):
    if not isinstance(relative, str) or not relative:
        return
    bucket = evidence_paths.setdefault(kind, [])
    if relative not in bucket:
        bucket.append(relative)


def record_ownership(relative, classification):
    if isinstance(relative, str) and relative:
        evidence_ownership[relative] = classification


def lexists(path):
    return os.path.lexists(path)


def is_within(path, root):
    path = os.path.realpath(path)
    root = os.path.realpath(root)
    return path == root or path.startswith(root + os.sep)


def validate_source_tree(source, label='distribution source', allowed_roots=None):
    """Reject broken or externally-targeted source links before any mutation."""
    roots = tuple(allowed_roots or (PLUGIN_ROOT,))
    contained = lambda candidate: any(is_within(candidate, root) for root in roots)
    if not lexists(source) or not contained(source):
        raise ValueError(f'{label} escapes the plugin root: {source}')
    if os.path.islink(source) and not os.path.exists(source):
        raise ValueError(f'{label} is a broken symlink: {source}')
    if not os.path.isdir(source):
        return
    for current, directories, files in os.walk(source, followlinks=False):
        for name in directories + files:
            child = os.path.join(current, name)
            if not os.path.islink(child):
                continue
            if not contained(child):
                raise ValueError(f'{label} symlink escapes the plugin root: {child}')
            if not os.path.exists(child):
                raise ValueError(f'{label} contains a broken symlink: {child}')


def ensure_codex_root_safe():
    if lexists(CODEX_ROOT) and os.path.islink(CODEX_ROOT):
        raise ValueError(f'project {DEST_REL} is a symlink; refusing to mutate outside the project')


def ensure_manifest_safe():
    ensure_codex_root_safe()
    if not lexists(MANIFEST):
        return
    if os.path.islink(MANIFEST):
        raise ValueError(f'project {DEST_REL} receipt is a symlink; refusing to follow it')
    if not os.path.isfile(MANIFEST):
        raise ValueError(f'project {DEST_REL} receipt is not a regular file; refusing to mutate it')


def has_symlink_ancestor(path):
    """Reject aliases in the destination parent chain, not just the leaf."""
    current = os.path.abspath(path)
    root = os.path.abspath(CODEX_ROOT)
    while current != root:
        if not is_within(current, root):
            return True
        if os.path.islink(current):
            return True
        parent = os.path.dirname(current)
        if parent == current:
            return True
        current = parent
    return False


def safe_destination(relative):
    if not isinstance(relative, str) or not relative or '\x00' in relative or '\\' in relative:
        raise ValueError('receipt destination is not a valid relative path')
    normalized = os.path.normpath(relative).replace(os.sep, '/')
    if os.path.isabs(relative) or (len(relative) > 1 and relative[1] == ':') or normalized != relative or normalized in ('.', '..') or normalized.startswith('../'):
        raise ValueError(f'receipt destination escapes project {DEST_REL}: {relative}')
    ensure_codex_root_safe()
    destination = os.path.join(CODEX_ROOT, *relative.split('/'))
    root_real = os.path.realpath(CODEX_ROOT)
    parent = os.path.dirname(destination)
    if has_symlink_ancestor(parent):
        raise ValueError(f'receipt destination has a symlinked parent: {relative}')
    if not is_within(parent, root_real):
        raise ValueError(f'receipt destination parent escapes project {DEST_REL}: {relative}')
    if lexists(destination) and not os.path.islink(destination) and not is_within(destination, root_real):
        raise ValueError(f'receipt destination escapes project {DEST_REL}: {relative}')
    return destination


_DIRECTORY_FLAGS = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)


class ReceiptCommitError(OSError):
    """Receipt replacement succeeded but its directory flush failed."""

    def __init__(self, message, committed=False):
        super().__init__(message)
        self.committed = committed


class AdoptionCommittedError(OSError):
    """Publication and receipt committed; only post-commit cleanup failed."""


def open_relative_directory(relative, create=False):
    """Open a `.codex` descendant one component at a time without symlink follow."""
    components = [component for component in relative.split('/') if component]
    try:
        fd = os.open(CODEX_ROOT, _DIRECTORY_FLAGS)
    except FileNotFoundError:
        if not create:
            raise
        os.mkdir(CODEX_ROOT, 0o700)
        fd = os.open(CODEX_ROOT, _DIRECTORY_FLAGS)
    try:
        for component in components:
            try:
                child = os.open(component, _DIRECTORY_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(component, 0o700, dir_fd=fd)
                child = os.open(component, _DIRECTORY_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except Exception:
        os.close(fd)
        raise


def acquire_install_lock():
    """Serialize mutating installers for the same project root."""
    global INSTALL_LOCK_FD
    ensure_codex_root_safe()
    root_fd = open_relative_directory('', create=True)
    try:
        fd = os.open(
            '.dhpk-install.lock',
            os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
            0o600,
            dir_fd=root_fd,
        )
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise ValueError('project .codex install lock is not a regular file')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise ValueError('another Codex installer is already reconciling this project')
        INSTALL_LOCK_FD = fd
    finally:
        os.close(root_fd)


def release_install_lock():
    global INSTALL_LOCK_FD
    if INSTALL_LOCK_FD is None:
        return
    try:
        fcntl.flock(INSTALL_LOCK_FD, fcntl.LOCK_UN)
    finally:
        os.close(INSTALL_LOCK_FD)
        INSTALL_LOCK_FD = None


atexit.register(release_install_lock)


def reject_non_finite_json_constant(value):
    raise ValueError(f'non-finite JSON constant is not allowed: {value}')


def parse_finite_json_float(value):
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f'non-finite JSON number is not allowed: {value}')
    return parsed


def read_manifest_document():
    """Read the receipt through a pinned `.codex` directory and no-follow leaf."""
    root_fd = open_relative_directory('', create=False)
    try:
        fd = os.open(
            os.path.basename(MANIFEST),
            os.O_RDONLY | os.O_NONBLOCK | getattr(os, 'O_NOFOLLOW', 0),
            dir_fd=root_fd,
        )
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise ValueError('project .codex receipt is not a regular file')
        with os.fdopen(fd, encoding='utf-8') as receipt_file:
            return json.load(
                receipt_file,
                parse_constant=reject_non_finite_json_constant,
                parse_float=parse_finite_json_float,
            )
    finally:
        os.close(root_fd)


def fd_entry_path(fd, name):
    for descriptor_root in ('/proc/self/fd', '/dev/fd'):
        proc_fd = os.path.join(descriptor_root, str(fd))
        if os.path.isdir(proc_fd):
            return os.path.join(proc_fd, name)
    raise ValueError('adoption requires a filesystem with descriptor-anchored paths')


def fd_entry_exists(fd, name):
    try:
        os.stat(name, dir_fd=fd, follow_symlinks=False)
        return True
    except FileNotFoundError:
        return False


def fsync_tree(path):
    """Flush a newly-created backup tree without following user links."""
    try:
        mode = os.lstat(path).st_mode
    except FileNotFoundError:
        return
    if stat.S_ISLNK(mode):
        return
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    try:
        if stat.S_ISDIR(mode):
            for name in os.listdir(fd):
                fsync_tree(os.path.join(path, name))
        os.fsync(fd)
    finally:
        os.close(fd)


def create_staging_directory(parent_fd):
    for _ in range(20):
        name = f'.dhpk-adopt-{uuid.uuid4().hex}'
        try:
            os.mkdir(name, 0o700, dir_fd=parent_fd)
        except FileExistsError:
            continue
        return name, os.open(name, _DIRECTORY_FLAGS, dir_fd=parent_fd)
    raise OSError('could not allocate a private adoption staging directory')


def remove_fd_entry(fd, name):
    if not fd_entry_exists(fd, name):
        return
    entry_stat = os.stat(name, dir_fd=fd, follow_symlinks=False)
    if stat.S_ISDIR(entry_stat.st_mode):
        tombstone = f'.dhpk-remove-{uuid.uuid4().hex}'
        os.rename(name, tombstone, src_dir_fd=fd, dst_dir_fd=fd)
        shutil.rmtree(fd_entry_path(fd, tombstone))
    else:
        os.unlink(name, dir_fd=fd)


def copy_fd_entry(source_fd, source_name, destination_fd, destination_name):
    """Copy a pinned tree without reopening a path through a raceable leaf."""
    source_stat = os.stat(source_name, dir_fd=source_fd, follow_symlinks=False)
    if stat.S_ISLNK(source_stat.st_mode):
        target = os.readlink(source_name, dir_fd=source_fd)
        os.symlink(target, destination_name, dir_fd=destination_fd)
        return
    if stat.S_ISDIR(source_stat.st_mode):
        os.mkdir(destination_name, source_stat.st_mode & 0o7777, dir_fd=destination_fd)
        source_child_fd = os.open(source_name, _DIRECTORY_FLAGS, dir_fd=source_fd)
        destination_child_fd = os.open(destination_name, _DIRECTORY_FLAGS, dir_fd=destination_fd)
        try:
            for child_name in sorted(os.listdir(source_child_fd)):
                copy_fd_entry(source_child_fd, child_name, destination_child_fd, child_name)
            os.fchmod(destination_child_fd, source_stat.st_mode & 0o7777)
            os.fsync(destination_child_fd)
        except Exception:
            try:
                remove_fd_entry(destination_fd, destination_name)
            except OSError:
                pass
            raise
        finally:
            os.close(destination_child_fd)
            os.close(source_child_fd)
        return
    if not stat.S_ISREG(source_stat.st_mode):
        raise ValueError(f'unsupported rollback entry type: {source_name}')
    source_file_fd = os.open(source_name, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0), dir_fd=source_fd)
    try:
        destination_file_fd = os.open(
            destination_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0),
            source_stat.st_mode & 0o7777,
            dir_fd=destination_fd,
        )
        closed = False
        try:
            while True:
                chunk = os.read(source_file_fd, 1024 * 1024)
                if not chunk:
                    break
                offset = 0
                while offset < len(chunk):
                    offset += os.write(destination_file_fd, chunk[offset:])
            os.fchmod(destination_file_fd, source_stat.st_mode & 0o7777)
            os.fsync(destination_file_fd)
        except Exception:
            os.close(destination_file_fd)
            closed = True
            try:
                os.unlink(destination_name, dir_fd=destination_fd)
            except OSError:
                pass
            raise
        finally:
            if not closed:
                os.close(destination_file_fd)
    finally:
        os.close(source_file_fd)


def restore_fd_copy(backup_fd, backup_name, destination_fd, destination_name):
    """Restore a pinned backup while retaining the backup for receipt evidence."""
    if fd_entry_exists(destination_fd, destination_name):
        return False
    copy_fd_entry(backup_fd, backup_name, destination_fd, destination_name)
    os.fsync(destination_fd)
    return True


def receipt_destination(kind, name, old):
    expected = name if kind == 'supporting_assets' else f'{kind}/{name}'
    if not isinstance(old, dict):
        raise ValueError(f'receipt entry {kind}/{name} is malformed')
    relative = old.get('destination') or old.get('source')
    if relative != expected or old.get('source') not in (None, expected):
        raise ValueError(f'receipt entry {kind}/{name} has an unexpected destination')
    return safe_destination(expected)


def remove_relative_path(relative, expected_fingerprint=None):
    """Remove one receipt-relative entry through a pinned parent directory.

    The leaf is first renamed to a private tombstone.  A failed recursive
    delete therefore cannot leave a partially deleted user-visible target;
    receipt rollback can restore the original backup while the tombstone is
    retained for manual cleanup.
    """
    safe_destination(relative)
    parent_relative, destination_name = os.path.split(relative)
    parent_fd = open_relative_directory(parent_relative)
    tombstone = f'.dhpk-remove-{uuid.uuid4().hex}'
    try:
        if not fd_entry_exists(parent_fd, destination_name):
            return
        if (expected_fingerprint is not None
                and hash_fd_entry(parent_fd, destination_name) != expected_fingerprint):
            raise ValueError(f'destination changed before removal: {relative}')
        os.rename(destination_name, tombstone, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        os.fsync(parent_fd)
        try:
            if (expected_fingerprint is not None
                    and hash_fd_entry(parent_fd, tombstone) != expected_fingerprint):
                os.rename(tombstone, destination_name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
                os.fsync(parent_fd)
                raise ValueError(f'destination changed during removal: {relative}')
            remove_fd_entry(parent_fd, tombstone)
            os.fsync(parent_fd)
        except Exception:
            # Keep the tombstone under the pinned parent.  The transaction
            # rollback restores the receipt-visible destination from backup.
            raise
    finally:
        os.close(parent_fd)


def backup_destination(relative, destination, reason):
    """Copy a proven managed target into a rollback-addressable project path."""
    safe_destination(relative)
    parent_relative, destination_name = os.path.split(relative)
    source_parent_fd = open_relative_directory(parent_relative)
    backup_relative = f'{BACKUP_DIR}/{BACKUP_RUN}/{relative}'
    backup_parent_relative, backup_name = os.path.split(backup_relative)
    try:
        if not fd_entry_exists(source_parent_fd, destination_name):
            return None
        backup_parent_fd = open_relative_directory(backup_parent_relative, create=True)
    except Exception:
        os.close(source_parent_fd)
        raise
    try:
        if fd_entry_exists(backup_parent_fd, backup_name):
            raise ValueError(f'rollback backup already exists: {relative}')
        source_entry = fd_entry_path(source_parent_fd, destination_name)
        backup_entry = fd_entry_path(backup_parent_fd, backup_name)
        copy_fd_entry(source_parent_fd, destination_name, backup_parent_fd, backup_name)
        fsync_tree(backup_entry)
        os.fsync(backup_parent_fd)
        original_fingerprint = hash_fd_entry(source_parent_fd, destination_name)
    finally:
        os.close(backup_parent_fd)
        os.close(source_parent_fd)
    backup_relative = f'{DEST_REL}/{backup_relative}'
    backup_records.append({
        'path': backup_relative,
        'original': relative,
        'reason': reason,
        'fingerprint': original_fingerprint,
    })
    record_path('backed_up', relative)
    return backup_relative


def restore_backup_copy(backup, destination):
    """Restore a backup while retaining the rollback copy for evidence."""
    backup_relative = os.path.relpath(backup, CODEX_ROOT).replace(os.sep, '/')
    destination_relative = os.path.relpath(destination, CODEX_ROOT).replace(os.sep, '/')
    safe_destination(backup_relative)
    safe_destination(destination_relative)
    if os.path.islink(backup) and (
            not (is_within(backup, CODEX_ROOT) or is_within(backup, PLUGIN_ROOT))):
        raise ValueError(f'rollback backup symlink escapes the Codex root: {backup_relative}')
    validate_source_tree(backup, 'rollback backup', allowed_roots=(CODEX_ROOT, PLUGIN_ROOT))
    backup_parent_relative, backup_name = os.path.split(backup_relative)
    destination_parent_relative, destination_name = os.path.split(destination_relative)
    backup_parent_fd = open_relative_directory(backup_parent_relative)
    try:
        destination_parent_fd = open_relative_directory(destination_parent_relative, create=True)
    except Exception:
        os.close(backup_parent_fd)
        raise
    try:
        return restore_fd_copy(
            backup_parent_fd,
            backup_name,
            destination_parent_fd,
            destination_name,
        )
    finally:
        os.close(destination_parent_fd)
        os.close(backup_parent_fd)


def register_pending_prune(relative, destination, backup_public):
    """Remember a retired removal until its replacement receipt is durable."""
    prefix = DEST_REL.rstrip('/') + '/'
    if not isinstance(backup_public, str) or not backup_public.startswith(prefix):
        raise ValueError(f'prune backup is outside the destination root: {relative}')
    backup_relative = backup_public[len(prefix):]
    if backup_relative != f'{BACKUP_DIR}/{BACKUP_RUN}/{relative}':
        raise ValueError(f'prune backup is not bound to this transaction: {relative}')
    pending_prunes.append({
        'relative': relative,
        'destination': destination,
        'backup': safe_destination(backup_relative),
    })
    persist_transaction_journal()


def register_pending_mutation(relative, destination, backup_public, expected_fingerprint):
    """Remember a created/replaced target until the new receipt is durable."""
    backup = None
    if backup_public is not None:
        prefix = DEST_REL.rstrip('/') + '/'
        if not isinstance(backup_public, str) or not backup_public.startswith(prefix):
            raise ValueError(f'mutation backup is outside the destination root: {relative}')
        backup_relative = backup_public[len(prefix):]
        if backup_relative != f'{BACKUP_DIR}/{BACKUP_RUN}/{relative}':
            raise ValueError(f'mutation backup is not bound to this transaction: {relative}')
        backup = safe_destination(backup_relative)
    if not isinstance(expected_fingerprint, str) or len(expected_fingerprint) != 64:
        raise ValueError(f'mutation fingerprint is invalid: {relative}')
    pending_mutations.append({
        'relative': relative,
        'destination': destination,
        'backup': backup,
        'expected': expected_fingerprint,
    })
    persist_transaction_journal()


def register_pending_adoption(state, relative, expected_source, expected_destination):
    """Journal an adoption before detach/publication so crash recovery can roll it back."""
    if not isinstance(state, dict):
        raise ValueError(f'adoption state is malformed: {relative}')
    if not all(isinstance(value, str) for value in (relative, expected_source, expected_destination)):
        raise ValueError(f'adoption journal fields are malformed: {relative}')
    if not re.fullmatch(r'[0-9a-fA-F]{64}', expected_source) or not re.fullmatch(r'[0-9a-fA-F]{64}', expected_destination):
        raise ValueError(f'adoption fingerprints are malformed: {relative}')
    record = {
        'relative': relative,
        'destination': state.get('destination_path'),
        'backup': os.path.join(CODEX_ROOT, *(state.get('backup_relative') or '').split('/')),
        'quarantine': None,
        'expected_source': expected_source,
        'expected_destination': expected_destination,
        'published': None,
        'phase': 'prepared',
    }
    if not all(isinstance(record.get(key), str) for key in ('destination', 'backup')):
        raise ValueError(f'adoption journal paths are malformed: {relative}')
    if state.get('backup_relative') != f'{BACKUP_DIR}/{BACKUP_RUN}/{relative}':
        raise ValueError(f'adoption backup is not bound to this transaction: {relative}')
    pending_adoptions.append(record)
    state['_adoption_record'] = record
    persist_transaction_journal()


def update_pending_adoption(state, phase, quarantine=None, published=None):
    record = state.get('_adoption_record') if isinstance(state, dict) else None
    if not isinstance(record, dict):
        raise ValueError('adoption journal record is missing')
    if phase not in ('prepared', 'quarantined', 'published', 'receipt_persisted', 'cleanup_pending', 'restored'):
        raise ValueError(f'unsupported adoption journal phase: {phase}')
    record['phase'] = phase
    if quarantine is not None:
        record['quarantine'] = quarantine if os.path.isabs(quarantine) else os.path.join(CODEX_ROOT, *quarantine.split('/'))
    if published is not None:
        record['published'] = published
    persist_transaction_journal()


def restore_pending_mutations():
    """Rollback created/replaced targets only while their bytes are unchanged."""
    errors = []
    for pending in reversed(pending_mutations):
        relative = pending.get('relative')
        destination = pending.get('destination')
        backup = pending.get('backup')
        expected = pending.get('expected')
        if not all(isinstance(value, str) for value in (relative, destination, expected)):
            errors.append('malformed pending mutation journal entry')
            continue
        try:
            if not lexists(destination):
                if backup is not None:
                    if not lexists(backup):
                        errors.append(f'rollback backup missing: {relative}')
                    else:
                        restore_backup_copy(backup, destination)
                continue
            if (backup is not None and lexists(backup)
                    and safe_destination_fingerprint(destination) == safe_destination_fingerprint(backup)):
                # The current process may already have completed rollback
                # before crashing while the journal was still active.
                continue
            if safe_destination_fingerprint(destination) != expected:
                errors.append(f'rollback preserved changed destination: {relative}')
                continue
            remove_relative_path(relative, expected)
            if backup is not None:
                if not lexists(backup):
                    errors.append(f'rollback backup missing after removal: {relative}')
                else:
                    restore_backup_copy(backup, destination)
        except (OSError, ValueError) as error:
            errors.append(f'{relative}: {error}')
    return errors


def restore_pending_adoptions():
    """Rollback an interrupted adoption while preserving changed user bytes."""
    def resolve_journal_path(value):
        relative = os.path.relpath(value, CODEX_ROOT).replace(os.sep, '/') if os.path.isabs(value) else value
        return safe_destination(relative), relative

    errors = []
    for pending in reversed(pending_adoptions):
        relative = pending.get('relative')
        destination_relative = pending.get('destination')
        backup_relative = pending.get('backup')
        quarantine_relative = pending.get('quarantine')
        expected_source = pending.get('expected_source')
        expected_destination = pending.get('expected_destination')
        published = pending.get('published')
        if not all(isinstance(value, str) for value in (
                relative, destination_relative, backup_relative,
                expected_source, expected_destination)):
            errors.append('malformed pending adoption journal entry')
            continue
        if (not re.fullmatch(r'[0-9a-fA-F]{64}', expected_source)
                or not re.fullmatch(r'[0-9a-fA-F]{64}', expected_destination)
                or (published is not None and not re.fullmatch(r'[0-9a-fA-F]{64}', published))):
            errors.append(f'malformed adoption fingerprints: {relative}')
            continue
        try:
            destination, destination_rel = resolve_journal_path(destination_relative)
            backup, _ = resolve_journal_path(backup_relative)
            quarantine, quarantine_rel = resolve_journal_path(quarantine_relative) if quarantine_relative else (None, None)
            if not lexists(backup):
                errors.append(f'adoption rollback backup missing: {relative}')
                continue
            backup_fingerprint = safe_destination_fingerprint(backup)
            if lexists(destination):
                current = safe_destination_fingerprint(destination)
                if current != backup_fingerprint:
                    expected_current = published or expected_source
                    source_current = safe_destination_fingerprint(destination, include_ignored=False)
                    if current != expected_current and source_current != expected_source:
                        errors.append(f'adoption rollback preserved changed destination: {relative}')
                        continue
                    remove_relative_path(destination_rel, published or expected_source)
            restore_backup_copy(backup, destination)
            if quarantine and lexists(quarantine):
                remove_relative_path(quarantine_rel)
            pending['phase'] = 'restored'
        except (OSError, ValueError) as error:
            errors.append(f'{relative}: {error}')
    return errors


def restore_pending_prunes():
    """Restore staged retired targets when receipt publication did not commit."""
    errors = []
    for pending in reversed(pending_prunes):
        destination = pending.get('destination')
        backup = pending.get('backup')
        if not isinstance(destination, str) or not isinstance(backup, str):
            continue
        if lexists(destination):
            continue
        if not lexists(backup):
            errors.append(f'rollback backup missing: {pending.get("relative")}')
            continue
        try:
            restore_backup_copy(backup, destination)
        except (OSError, ValueError) as error:
            errors.append(f'{pending.get("relative")}: {error}')
    return errors


def rollback_pending():
    """Attempt every pending rollback and report failures instead of hiding them."""
    errors = restore_pending_adoptions()
    errors.extend(restore_pending_mutations())
    errors.extend(restore_pending_prunes())
    errors.extend(restore_receipt_archive())
    errors.extend(restore_receipt_snapshot())
    if errors:
        print('[install-codex-skills] ERROR: rollback incomplete: ' + '; '.join(errors), file=sys.stderr)
    return errors


def rollback_uncaught_exception(exc_type, exc_value, traceback):
    """Restore staged removals even when a later mutation raises unexpectedly."""
    try:
        rollback_pending()
    finally:
        sys.__excepthook__(exc_type, exc_value, traceback)


sys.excepthook = rollback_uncaught_exception


def clear_pending_prunes():
    pending_prunes[:] = []


def clear_pending_transactions():
    pending_prunes[:] = []
    pending_mutations[:] = []
    pending_adoptions[:] = []


def _journal_relative(path):
    return os.path.relpath(path, CODEX_ROOT).replace(os.sep, '/')


def _journal_pending_entries():
    return {
        'prunes': [
            {
                'relative': item.get('relative'),
                'destination': _journal_relative(item.get('destination')) if isinstance(item.get('destination'), str) else None,
                'backup': _journal_relative(item.get('backup')) if isinstance(item.get('backup'), str) else None,
            }
            for item in pending_prunes
        ],
        'mutations': [
            {
                'relative': item.get('relative'),
                'destination': _journal_relative(item.get('destination')) if isinstance(item.get('destination'), str) else None,
                'backup': _journal_relative(item.get('backup')) if isinstance(item.get('backup'), str) else None,
                'expected': item.get('expected'),
            }
            for item in pending_mutations
        ],
        'adoptions': [
            {
                'relative': item.get('relative'),
                'destination': _journal_relative(item.get('destination')) if isinstance(item.get('destination'), str) else None,
                'backup': _journal_relative(item.get('backup')) if isinstance(item.get('backup'), str) else None,
                'quarantine': _journal_relative(item.get('quarantine')) if isinstance(item.get('quarantine'), str) else None,
                'expected_source': item.get('expected_source'),
                'expected_destination': item.get('expected_destination'),
                'published': item.get('published'),
                'phase': item.get('phase'),
            }
            for item in pending_adoptions
        ],
    }


def persist_transaction_journal(phase=None, plugin_version=None, source_fingerprint=None):
    """Durably record rollback actions before publishing a replacement receipt."""
    if not isinstance(TRANSACTION_JOURNAL, dict):
        return
    TRANSACTION_JOURNAL['started'] = True
    if phase is not None:
        TRANSACTION_JOURNAL['phase'] = phase
    if plugin_version is not None:
        TRANSACTION_JOURNAL['plugin_version'] = plugin_version
    if source_fingerprint is not None:
        TRANSACTION_JOURNAL['source_fingerprint'] = source_fingerprint
    pending = _journal_pending_entries()
    payload = dict(TRANSACTION_JOURNAL)
    payload.update(pending)
    journal_relative = payload.get('relative')
    if not isinstance(journal_relative, str):
        raise ValueError('transaction journal path is malformed')
    safe_destination(journal_relative)
    parent_relative, journal_name = os.path.split(journal_relative)
    parent_fd = open_relative_directory(parent_relative, create=True)
    temporary_name = f'.transaction.json.{uuid.uuid4().hex}'
    try:
        fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0),
            0o600,
            dir_fd=parent_fd,
        )
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, indent=2, sort_keys=True)
            fh.write('\n')
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary_name, journal_name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        os.fsync(parent_fd)
    finally:
        try:
            os.unlink(temporary_name, dir_fd=parent_fd)
        except FileNotFoundError:
            pass
        os.close(parent_fd)


def restore_receipt_snapshot():
    """Restore the receipt that existed before an active transaction began."""
    if not isinstance(TRANSACTION_JOURNAL, dict) or 'receipt_snapshot_present' not in TRANSACTION_JOURNAL:
        return []
    errors = []
    present = TRANSACTION_JOURNAL.get('receipt_snapshot_present') is True
    snapshot = TRANSACTION_JOURNAL.get('receipt_snapshot')
    run = TRANSACTION_JOURNAL.get('run')
    current = None
    current_exists = lexists(MANIFEST)
    if current_exists:
        try:
            current = read_manifest_document()
        except (OSError, ValueError, json.JSONDecodeError) as error:
            return [f'receipt snapshot recovery cannot read the live receipt: {error}']
        if isinstance(current, dict) and current == snapshot:
            return []
        if not (isinstance(current, dict)
                and current.get('transaction_id') == run
                and current.get('transaction_final') is False):
            return ['receipt snapshot recovery refused to overwrite a receipt not owned by the active transaction']
    if not present:
        if not current_exists:
            return []
        try:
            root_fd = open_relative_directory('', create=False)
            try:
                os.unlink(os.path.basename(MANIFEST), dir_fd=root_fd)
                os.fsync(root_fd)
            finally:
                os.close(root_fd)
        except (OSError, ValueError) as error:
            errors.append(f'receipt snapshot removal failed: {error}')
        return errors
    if not isinstance(snapshot, dict):
        return ['receipt snapshot is malformed; manual recovery required']
    root_fd = open_relative_directory('', create=True)
    temporary_name = f'.dhpk-installed.json.snapshot.{uuid.uuid4().hex}'
    try:
        fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0),
            0o600,
            dir_fd=root_fd,
        )
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(snapshot, fh, indent=2, sort_keys=True)
            fh.write('\n')
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary_name, os.path.basename(MANIFEST), src_dir_fd=root_fd, dst_dir_fd=root_fd)
        os.fsync(root_fd)
    except (OSError, ValueError) as error:
        errors.append(f'receipt snapshot restore failed: {error}')
    finally:
        try:
            os.unlink(temporary_name, dir_fd=root_fd)
        except FileNotFoundError:
            pass
        os.close(root_fd)
    return errors


def begin_transaction(plugin_version, source_fingerprint, receipt_snapshot=None, receipt_snapshot_present=False):
    """Start a durable transaction after all read-only preflight has passed."""
    global TRANSACTION_JOURNAL
    TRANSACTION_JOURNAL = {
        'run': BACKUP_RUN,
        'pid': os.getpid(),
        'relative': f'.dhpk-transaction-{BACKUP_RUN}.json',
        'phase': 'active',
        'started': False,
        'plugin_version': plugin_version,
        'source_fingerprint': source_fingerprint,
        'receipt_snapshot_present': bool(receipt_snapshot_present),
        'receipt_snapshot': (
            receipt_snapshot if receipt_snapshot_present and isinstance(receipt_snapshot, dict)
            else None
        ),
    }
    persist_transaction_journal()


def finish_transaction(phase='committed'):
    if (not isinstance(TRANSACTION_JOURNAL, dict)
            or not TRANSACTION_JOURNAL.get('started')):
        return
    persist_transaction_journal(phase=phase)


def archive_receipt_for_uninstall():
    """Quarantine the receipt with descriptor-relative rename and fsync."""
    ensure_manifest_safe()
    root_fd = open_relative_directory('', create=False)
    backup_relative = f'{BACKUP_DIR}/{BACKUP_RUN}/receipt.json'
    backup_parent_relative, backup_name = os.path.split(backup_relative)
    backup_fd = open_relative_directory(backup_parent_relative, create=True)
    moved = False
    try:
        receipt_name = os.path.basename(MANIFEST)
        if not fd_entry_exists(root_fd, receipt_name):
            return None
        if fd_entry_exists(backup_fd, backup_name):
            raise ValueError('uninstall receipt backup already exists; retry with a fresh transaction')
        if isinstance(TRANSACTION_JOURNAL, dict):
            TRANSACTION_JOURNAL['receipt_archive'] = backup_relative
            persist_transaction_journal()
        os.rename(receipt_name, backup_name, src_dir_fd=root_fd, dst_dir_fd=backup_fd)
        moved = True
        if FAIL_UNINSTALL_RECEIPT_FSYNC_FOR_TEST:
            raise OSError('test-injected uninstall receipt fsync failure')
        os.fsync(root_fd)
        os.fsync(backup_fd)
    except OSError as error:
        if moved:
            raise ReceiptCommitError(
                f'uninstall receipt quarantine committed but directory durability failed: {error}',
                committed=True,
            )
        raise
    finally:
        os.close(backup_fd)
        os.close(root_fd)
    public_backup = f'{DEST_REL}/{backup_relative}'
    backup_records.append({
        'path': public_backup,
        'original': f'{DEST_REL}/.dhpk-installed.json',
        'reason': 'uninstall-receipt',
    })
    return public_backup


def restore_receipt_archive():
    """Restore a quarantined receipt when an uninstall transaction aborts."""
    if not isinstance(TRANSACTION_JOURNAL, dict):
        return []
    archive_relative = TRANSACTION_JOURNAL.get('receipt_archive')
    if not isinstance(archive_relative, str):
        return []
    run = TRANSACTION_JOURNAL.get('run')
    expected_archive = f'{BACKUP_DIR}/{run}/receipt.json'
    if not isinstance(run, str) or archive_relative != expected_archive:
        return ['uninstall receipt archive is not bound to the active transaction']
    errors = []
    try:
        safe_destination(archive_relative)
        archive_parent_relative, archive_name = os.path.split(archive_relative)
        archive_fd = open_relative_directory(archive_parent_relative)
        root_fd = open_relative_directory('', create=True)
        try:
            receipt_name = os.path.basename(MANIFEST)
            if fd_entry_exists(root_fd, receipt_name):
                if fd_entry_exists(archive_fd, archive_name):
                    errors.append('cannot restore uninstall receipt: live receipt already exists')
                return errors
            if not fd_entry_exists(archive_fd, archive_name):
                return errors
            os.rename(archive_name, receipt_name, src_dir_fd=archive_fd, dst_dir_fd=root_fd)
            os.fsync(archive_fd)
            os.fsync(root_fd)
        finally:
            os.close(root_fd)
            os.close(archive_fd)
    except (OSError, ValueError) as error:
        errors.append(f'uninstall receipt restore failed: {error}')
    return errors


def _pid_is_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _read_relative_json(parent_fd, name):
    fd = os.open(
        name,
        os.O_RDONLY | os.O_NONBLOCK | getattr(os, 'O_NOFOLLOW', 0),
        dir_fd=parent_fd,
    )
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError(f'transaction journal {name} is not a regular file')
        with os.fdopen(fd, encoding='utf-8') as fh:
            return json.load(fh)
    finally:
        # fdopen closes the descriptor; the guard is intentionally empty.
        pass


def receipt_proves_pending_adoptions(receipt):
    """Return true only when a partial receipt proves every adoption published."""
    if (not isinstance(receipt, dict)
            or not isinstance(TRANSACTION_JOURNAL, dict)
            or receipt.get('transaction_id') != TRANSACTION_JOURNAL.get('run')
            or receipt.get('transaction_final') is not False
            or receipt.get('plugin_version') != TRANSACTION_JOURNAL.get('plugin_version')
            or receipt.get('source_fingerprint') != TRANSACTION_JOURNAL.get('source_fingerprint')
            or not pending_adoptions):
        return False
    managed = receipt.get('managed_entries')
    if not isinstance(managed, dict):
        return False
    for pending in pending_adoptions:
        relative = pending.get('relative')
        expected_source = pending.get('expected_source')
        published = pending.get('published')
        phase = pending.get('phase')
        if (not isinstance(relative, str) or not isinstance(expected_source, str)
                or phase not in ('published', 'receipt_persisted', 'cleanup_pending')
                or not isinstance(published, str)):
            return False
        destination = safe_destination(relative)
        if safe_destination_fingerprint(destination) != published:
            return False
        found = False
        for entries in managed.values():
            if not isinstance(entries, dict):
                continue
            for entry in entries.values():
                if (isinstance(entry, dict)
                        and entry.get('destination') == relative
                        and entry.get('source_fingerprint') == expected_source
                        and is_owned(entry, destination)):
                    found = True
                    break
            if found:
                break
        if not found:
            return False
    return True


def cleanup_pending_adoptions():
    """Remove only adoption quarantines after a partial receipt proves publication."""
    errors = []
    for pending in reversed(pending_adoptions):
        quarantine = pending.get('quarantine')
        if not isinstance(quarantine, str):
            continue
        quarantine_relative = os.path.relpath(quarantine, CODEX_ROOT).replace(os.sep, '/') if os.path.isabs(quarantine) else quarantine
        try:
            safe_destination(quarantine_relative)
            if lexists(quarantine):
                remove_relative_path(quarantine_relative)
            pending['phase'] = 'cleanup_recovered'
        except (OSError, ValueError) as error:
            errors.append(f'{pending.get("relative")}: adoption quarantine cleanup failed: {error}')
    return errors


def finalize_recovered_receipt(receipt):
    """Make a receipt-proven partial adoption durable before committing its journal."""
    if not isinstance(receipt, dict):
        return ['partial adoption receipt is malformed']
    final_receipt = dict(receipt)
    final_receipt['transaction_id'] = TRANSACTION_JOURNAL.get('run') if isinstance(TRANSACTION_JOURNAL, dict) else None
    final_receipt['transaction_final'] = True
    errors = []
    root_fd = open_relative_directory('', create=True)
    temporary_name = f'.dhpk-installed.json.recovery.{uuid.uuid4().hex}'
    try:
        fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0),
            0o600,
            dir_fd=root_fd,
        )
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(final_receipt, fh, indent=2, sort_keys=True)
            fh.write('\n')
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary_name, os.path.basename(MANIFEST), src_dir_fd=root_fd, dst_dir_fd=root_fd)
        os.fsync(root_fd)
    except (OSError, ValueError) as error:
        errors.append(f'partial adoption receipt finalization failed: {error}')
    finally:
        try:
            os.unlink(temporary_name, dir_fd=root_fd)
        except FileNotFoundError:
            pass
        os.close(root_fd)
    return errors


def recover_stale_transactions():
    """Recover interrupted transactions before reading the current receipt."""
    global TRANSACTION_JOURNAL
    if not lexists(CODEX_ROOT) or os.path.islink(CODEX_ROOT):
        return
    try:
        root_fd = open_relative_directory('')
    except FileNotFoundError:
        return
    try:
        journal_names = sorted(os.listdir(root_fd))
    finally:
        os.close(root_fd)
    for journal_name in journal_names:
        match = re.fullmatch(r'\.dhpk-transaction-(\d{8}T\d{6}Z-\d+)\.json', journal_name)
        if not match:
            continue
        run = match.group(1)
        journal_relative = journal_name
        try:
            journal_parent_relative, journal_name = os.path.split(journal_relative)
            journal_parent_fd = open_relative_directory(journal_parent_relative)
            try:
                journal = _read_relative_json(journal_parent_fd, journal_name)
            finally:
                os.close(journal_parent_fd)
        except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError) as error:
            print(f'[install-codex-skills] ERROR: transaction journal {run} cannot be read; manual recovery required: {error}', file=sys.stderr)
            raise ValueError(f'transaction journal {run} is unreadable')
        if not isinstance(journal, dict):
            raise ValueError(f'transaction journal {run} is malformed; manual recovery required')
        if (journal.get('relative') != journal_relative
                or journal.get('run') != run
                or not isinstance(journal.get('pid'), int)
                or journal.get('pid') <= 0
                or journal.get('started') is not True
                or not isinstance(journal.get('plugin_version'), str)
                or not re.fullmatch(r'[0-9a-fA-F]{64}', journal.get('source_fingerprint', ''))):
            raise ValueError(f'transaction journal {run} identity is malformed; manual recovery required')
        if 'receipt_snapshot_present' not in journal or not isinstance(journal.get('receipt_snapshot_present'), bool):
            raise ValueError(f'transaction journal {run} receipt snapshot marker is malformed; manual recovery required')
        if journal.get('receipt_snapshot_present') and not isinstance(journal.get('receipt_snapshot'), dict):
            raise ValueError(f'transaction journal {run} receipt snapshot is malformed; manual recovery required')
        if (not journal.get('receipt_snapshot_present')
                and journal.get('receipt_snapshot') is not None):
            raise ValueError(f'transaction journal {run} has an unexpected receipt snapshot; manual recovery required')
        if 'receipt_archive' in journal:
            if journal.get('receipt_archive') != f'{BACKUP_DIR}/{run}/receipt.json':
                raise ValueError(f'transaction journal {run} receipt archive is not transaction-bound; manual recovery required')
        phase = journal.get('phase')
        if phase == 'rollback_incomplete':
            raise ValueError(f'interrupted transaction {run} previously reported incomplete rollback; manual recovery required')
        if phase not in ('active', 'committed', 'rolled_back'):
            raise ValueError(f'transaction journal {run} has unsupported phase {phase!r}; manual recovery required')
        if phase != 'active':
            continue
        if _pid_is_alive(journal.get('pid')):
            print(f'[install-codex-skills] ERROR: active transaction {run} is owned by a live process; refusing concurrent reconciliation', file=sys.stderr)
            raise ValueError(f'active transaction {run} is still running')

        TRANSACTION_JOURNAL = dict(journal)
        try:
            ensure_manifest_safe()
            committed_receipt = read_manifest_document()
        except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError):
            committed_receipt = None
        if (isinstance(committed_receipt, dict)
                and committed_receipt.get('transaction_id') == run
                and committed_receipt.get('transaction_final') is True
                and committed_receipt.get('plugin_version') == journal.get('plugin_version')
                and committed_receipt.get('source_fingerprint') == journal.get('source_fingerprint')):
            clear_pending_transactions()
            finish_transaction('committed')
            TRANSACTION_JOURNAL = None
            continue
        pending_prunes[:] = []
        pending_mutations[:] = []
        pending_adoptions[:] = []
        raw_prunes = journal.get('prunes')
        raw_mutations = journal.get('mutations')
        raw_adoptions = journal.get('adoptions', [])
        if (not isinstance(raw_prunes, list) or not isinstance(raw_mutations, list)
                or not isinstance(raw_adoptions, list)):
            raise ValueError(f'interrupted transaction {run} has malformed rollback lists; manual recovery required')
        for item in raw_prunes:
            if not isinstance(item, dict):
                raise ValueError(f'interrupted transaction {run} has a malformed prune entry; manual recovery required')
            relative = item.get('relative')
            destination_relative = item.get('destination') or relative
            backup_relative = item.get('backup')
            if not all(isinstance(value, str) for value in (relative, destination_relative, backup_relative)):
                raise ValueError(f'interrupted transaction {run} has an invalid prune entry; manual recovery required')
            if (destination_relative != relative
                    or backup_relative != f'{BACKUP_DIR}/{run}/{relative}'):
                raise ValueError(f'interrupted transaction {run} has an unbound prune entry; manual recovery required')
            try:
                safe_destination(relative)
                pending_prunes.append({
                    'relative': relative,
                    'destination': safe_destination(destination_relative),
                    'backup': safe_destination(backup_relative),
                })
            except (OSError, ValueError) as error:
                raise ValueError(f'interrupted transaction {run} has an unsafe prune entry: {error}')
        for item in raw_mutations:
            if not isinstance(item, dict):
                raise ValueError(f'interrupted transaction {run} has a malformed mutation entry; manual recovery required')
            relative = item.get('relative')
            destination_relative = item.get('destination') or relative
            expected = item.get('expected')
            if not isinstance(relative, str) or not isinstance(destination_relative, str) or not isinstance(expected, str):
                raise ValueError(f'interrupted transaction {run} has an invalid mutation entry; manual recovery required')
            if not re.fullmatch(r'[0-9a-fA-F]{64}', expected):
                raise ValueError(f'interrupted transaction {run} has an invalid mutation fingerprint; manual recovery required')
            backup_relative = item.get('backup')
            if backup_relative is not None and not isinstance(backup_relative, str):
                raise ValueError(f'interrupted transaction {run} has an invalid mutation backup; manual recovery required')
            if (destination_relative != relative
                    or (backup_relative is not None
                        and backup_relative != f'{BACKUP_DIR}/{run}/{relative}')):
                raise ValueError(f'interrupted transaction {run} has an unbound mutation entry; manual recovery required')
            try:
                safe_destination(relative)
                pending_mutations.append({
                    'relative': relative,
                    'destination': safe_destination(destination_relative),
                    'backup': safe_destination(backup_relative) if isinstance(backup_relative, str) else None,
                    'expected': expected,
                })
            except (OSError, ValueError) as error:
                raise ValueError(f'interrupted transaction {run} has an unsafe mutation entry: {error}')
        for item in raw_adoptions:
            if not isinstance(item, dict):
                raise ValueError(f'interrupted transaction {run} has a malformed adoption entry; manual recovery required')
            relative = item.get('relative')
            destination_relative = item.get('destination')
            backup_relative = item.get('backup')
            quarantine_relative = item.get('quarantine')
            expected_source = item.get('expected_source')
            expected_destination = item.get('expected_destination')
            published = item.get('published')
            phase = item.get('phase')
            if (not all(isinstance(value, str) for value in (
                    relative, destination_relative, backup_relative,
                    expected_source, expected_destination))
                    or (quarantine_relative is not None and not isinstance(quarantine_relative, str))
                    or (published is not None and not isinstance(published, str))
                    or phase not in ('prepared', 'quarantined', 'published', 'receipt_persisted', 'cleanup_pending', 'restored')):
                raise ValueError(f'interrupted transaction {run} has an invalid adoption entry; manual recovery required')
            if (destination_relative != relative
                    or backup_relative != f'{BACKUP_DIR}/{run}/{relative}'
                    or (quarantine_relative is not None
                        and (not quarantine_relative.startswith(f'{BACKUP_DIR}/{run}/')
                             or os.path.dirname(quarantine_relative) != os.path.dirname(backup_relative)))):
                raise ValueError(f'interrupted transaction {run} has an unbound adoption entry; manual recovery required')
            if (not re.fullmatch(r'[0-9a-fA-F]{64}', expected_source)
                    or not re.fullmatch(r'[0-9a-fA-F]{64}', expected_destination)
                    or (published is not None and not re.fullmatch(r'[0-9a-fA-F]{64}', published))):
                raise ValueError(f'interrupted transaction {run} has an invalid adoption fingerprint; manual recovery required')
            try:
                safe_destination(relative)
                safe_destination(destination_relative)
                safe_destination(backup_relative)
                if quarantine_relative:
                    safe_destination(quarantine_relative)
            except (OSError, ValueError) as error:
                raise ValueError(f'interrupted transaction {run} has an unsafe adoption entry: {error}')
            pending_adoptions.append({
                'relative': relative,
                'destination': safe_destination(destination_relative),
                'backup': safe_destination(backup_relative),
                'quarantine': safe_destination(quarantine_relative) if quarantine_relative else None,
                'expected_source': expected_source,
                'expected_destination': expected_destination,
                'published': published,
                'phase': phase,
            })
        if receipt_proves_pending_adoptions(committed_receipt):
            errors = cleanup_pending_adoptions()
            if not errors:
                errors.extend(finalize_recovered_receipt(committed_receipt))
            if errors:
                finish_transaction('rollback_incomplete')
                raise ValueError(f'interrupted transaction {run} requires manual recovery: {"; ".join(errors)}')
            clear_pending_transactions()
            finish_transaction('committed')
            TRANSACTION_JOURNAL = None
            continue
        errors = rollback_pending()
        if errors:
            finish_transaction('rollback_incomplete')
            raise ValueError(f'interrupted transaction {run} requires manual recovery')
        clear_pending_transactions()
        finish_transaction('rolled_back')
        TRANSACTION_JOURNAL = None


def inspect_stale_transactions_for_plan():
    """Inspect journals without mutating state; plans must fail closed."""
    if not lexists(CODEX_ROOT) or os.path.islink(CODEX_ROOT):
        return []
    try:
        root_fd = open_relative_directory('', create=False)
    except FileNotFoundError:
        return []
    try:
        journal_names = sorted(os.listdir(root_fd))
    finally:
        os.close(root_fd)
    blocked = []
    for journal_name in journal_names:
        match = re.fullmatch(r'\.dhpk-transaction-(\d{8}T\d{6}Z-\d+)\.json', journal_name)
        if not match:
            continue
        run = match.group(1)
        try:
            journal_parent_relative, journal_leaf = os.path.split(journal_name)
            journal_parent_fd = open_relative_directory(journal_parent_relative)
            try:
                journal = _read_relative_json(journal_parent_fd, journal_leaf)
            finally:
                os.close(journal_parent_fd)
        except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError) as error:
            blocked.append(f'{journal_name}: unreadable ({error})')
            continue
        if not isinstance(journal, dict):
            blocked.append(f'{journal_name}: malformed')
            continue
        if (journal.get('relative') != journal_name
                or journal.get('run') != run
                or not isinstance(journal.get('pid'), int)
                or journal.get('pid') <= 0
                or journal.get('started') is not True
                or not isinstance(journal.get('plugin_version'), str)
                or not re.fullmatch(r'[0-9a-fA-F]{64}', journal.get('source_fingerprint', ''))):
            blocked.append(f'{journal_name}: journal path is not self-bound')
            continue
        if 'receipt_snapshot_present' not in journal or not isinstance(journal.get('receipt_snapshot_present'), bool):
            blocked.append(f'{journal_name}: receipt snapshot marker is malformed')
            continue
        if journal.get('receipt_snapshot_present') and not isinstance(journal.get('receipt_snapshot'), dict):
            blocked.append(f'{journal_name}: receipt snapshot is malformed')
            continue
        if (not journal.get('receipt_snapshot_present')
                and journal.get('receipt_snapshot') is not None):
            blocked.append(f'{journal_name}: receipt snapshot is unexpectedly present')
            continue
        if ('receipt_archive' in journal
                and journal.get('receipt_archive') != f'{BACKUP_DIR}/{run}/receipt.json'):
            blocked.append(f'{journal_name}: receipt archive is not transaction-bound')
            continue
        phase = journal.get('phase')
        if phase == 'active':
            blocked.append(f'{journal_name}: interrupted transaction requires recovery')
        elif phase not in ('committed', 'rolled_back'):
            blocked.append(f'{journal_name}: unsupported phase {phase!r}')
    return blocked


def prepare_adoption_backup(relative, destination, expected_fingerprint):
    """Copy a selected collision before receipt persistence, without detaching it."""
    parent_relative, destination_name = os.path.split(relative)
    destination_fd = open_relative_directory(parent_relative)
    backup_relative = f'{BACKUP_DIR}/{BACKUP_RUN}/{relative}'
    backup_parent_relative, backup_name = os.path.split(backup_relative)
    try:
        backup_fd = open_relative_directory(backup_parent_relative, create=True)
    except Exception:
        os.close(destination_fd)
        raise
    try:
        if not fd_entry_exists(destination_fd, destination_name):
            raise ValueError(f'adoption target disappeared: {relative}; run a fresh plan')
        if fd_entry_exists(backup_fd, backup_name):
            raise ValueError(f'adoption backup already exists: {relative}; retry with a fresh plan')
        original = fd_entry_path(destination_fd, destination_name)
        backup = fd_entry_path(backup_fd, backup_name)
        copy_fd_entry(destination_fd, destination_name, backup_fd, backup_name)
        actual = hash_fd_entry(backup_fd, backup_name)
        if actual != expected_fingerprint:
            remove_fd_entry(backup_fd, backup_name)
            raise ValueError(f'adoption preflight changed: {relative}; run a fresh plan')
        fsync_tree(backup)
        os.fsync(backup_fd)
    except Exception:
        try:
            if fd_entry_exists(backup_fd, backup_name) and not fd_entry_exists(destination_fd, destination_name):
                os.rename(backup_name, destination_name, src_dir_fd=backup_fd, dst_dir_fd=destination_fd)
        except OSError:
            pass
        os.close(backup_fd)
        os.close(destination_fd)
        raise
    public_backup = f'{DEST_REL}/{backup_relative}'
    backup_records.append({
        'path': public_backup,
        'original': relative,
        'reason': 'explicit-adoption',
        'fingerprint': actual,
    })
    record_path('backed_up', relative)
    return {
        'public': public_backup,
        'relative': relative,
        'destination_path': destination,
        'backup_relative': backup_relative,
        'backup_fd': backup_fd,
        'backup_name': backup_name,
        'destination_fd': destination_fd,
        'destination_name': destination_name,
        'backup_path': fd_entry_path(backup_fd, backup_name),
        'quarantine_name': None,
        'receipt_persisted': False,
    }


def stage_materialization(source, destination, destination_fd):
    """Build a new projection in a descriptor-pinned staging directory."""
    stage_name, stage_fd = create_staging_directory(destination_fd)
    staged_name = os.path.basename(destination)
    staged = fd_entry_path(stage_fd, staged_name)
    try:
        if MODE == 'symlink':
            os.symlink(source, staged_name, target_is_directory=os.path.isdir(source), dir_fd=stage_fd)
        elif os.path.isdir(source):
            shutil.copytree(source, staged, symlinks=False, ignore=ignore_distribution_entries)
        else:
            shutil.copy2(source, staged)
        fsync_tree(staged)
        os.fsync(stage_fd)
        return stage_name, stage_fd, staged_name, staged
    except Exception:
        if fd_entry_exists(stage_fd, staged_name):
            remove_fd_entry(stage_fd, staged_name)
        os.close(stage_fd)
        os.rmdir(stage_name, dir_fd=destination_fd)
        raise


def adopt_materialized(source, destination, relative, expected_source, expected_destination,
                       persist_backup=None, persist_adoption=None):
    """Publish one adoption with atomic detach, staging, and rollback checks."""
    state = prepare_adoption_backup(relative, destination, expected_destination)
    register_pending_adoption(state, relative, expected_source, expected_destination)
    destination_fd = state['destination_fd']
    destination_name = state['destination_name']
    backup_fd = state['backup_fd']
    backup_name = state['backup_name']
    stage_fd = None
    stage_name = None
    staged_name = None
    published_fingerprint = None
    state['receipt_committed'] = False
    try:
        if persist_backup is not None:
            # Make the detached original and its rollback path durable before
            # any new projection bytes are published.
            try:
                persist_backup()
            except ReceiptCommitError as error:
                if error.committed:
                    state['receipt_persisted'] = True
                raise
            state['receipt_persisted'] = True
        quarantine_name = f'.dhpk-original-{uuid.uuid4().hex}'
        os.rename(
            state['destination_name'],
            quarantine_name,
            src_dir_fd=destination_fd,
            dst_dir_fd=backup_fd,
        )
        state['quarantine_name'] = quarantine_name
        update_pending_adoption(
            state,
            'quarantined',
            quarantine=os.path.join(os.path.dirname(state['backup_relative']), quarantine_name),
        )
        if ABORT_ADOPTION_PHASE_FOR_TEST == 'quarantine':
            os._exit(73)
        os.fsync(backup_fd)
        quarantined = fd_entry_path(backup_fd, quarantine_name)
        if hash_fd_entry(backup_fd, quarantine_name) != expected_destination:
            restore_fd_copy(backup_fd, backup_name, destination_fd, destination_name)
            raise ValueError(f'adoption preflight changed: {relative}; run a fresh plan')
        if hash_path(source, include_ignored=False) != expected_source:
            raise ValueError(f'adoption source changed: {relative}; run a fresh plan')
        stage_name, stage_fd, staged_name, staged = stage_materialization(source, destination, destination_fd)
        if hash_path(staged, include_ignored=False) != expected_source:
            raise ValueError(f'adoption materialization changed: {relative}; run a fresh plan')
        if hash_path(source, include_ignored=False) != expected_source:
            raise ValueError(f'adoption source changed: {relative}; run a fresh plan')
        if fd_entry_exists(destination_fd, destination_name):
            raise ValueError(f'adoption target reappeared: {relative}; run a fresh plan')
        os.replace(staged_name, destination_name, src_dir_fd=stage_fd, dst_dir_fd=destination_fd)
        os.fsync(destination_fd)
        published_fingerprint = hash_fd_entry(destination_fd, destination_name)
        update_pending_adoption(state, 'published', published=published_fingerprint)
        if ABORT_ADOPTION_PHASE_FOR_TEST == 'published':
            os._exit(73)
        if hash_path(source, include_ignored=False) != expected_source:
            if (fd_entry_exists(destination_fd, destination_name)
                    and hash_fd_entry(destination_fd, destination_name) == published_fingerprint):
                remove_fd_entry(destination_fd, destination_name)
            restore_fd_copy(backup_fd, backup_name, destination_fd, destination_name)
            raise ValueError(f'adoption source changed: {relative}; run a fresh plan')
        if persist_adoption is not None:
            # Keep the original in quarantine and the rollback copy available
            # until the final ownership receipt is durable. If this callback
            # fails, the exception path restores the original before closing
            # the descriptor-pinned transaction.
            try:
                persist_adoption()
            except ReceiptCommitError as error:
                if error.committed:
                    state['receipt_committed'] = True
                raise
            update_pending_adoption(state, 'receipt_persisted', published=published_fingerprint)
            if ABORT_ADOPTION_PHASE_FOR_TEST == 'receipt_persisted':
                os._exit(73)
        state['receipt_committed'] = True
        update_pending_adoption(state, 'cleanup_pending', published=published_fingerprint)
        try:
            remove_fd_entry(backup_fd, quarantine_name)
            os.fsync(backup_fd)
        except OSError as error:
            # The replacement and receipt are already committed. Keep the
            # quarantine/backup evidence for a later cleanup rather than
            # rolling the projection back behind its durable receipt.
            raise AdoptionCommittedError(f'adoption committed; quarantine cleanup deferred: {error}')
        state['quarantine_name'] = None
        return state['public']
    except ReceiptCommitError:
        if not state.get('receipt_committed'):
            raise
        raise
    except Exception:
        if state.get('receipt_committed'):
            raise
        if fd_entry_exists(destination_fd, destination_name) and published_fingerprint is not None:
            try:
                if hash_fd_entry(destination_fd, destination_name) == published_fingerprint:
                    remove_fd_entry(destination_fd, destination_name)
            except OSError:
                pass
        if (fd_entry_exists(backup_fd, backup_name)
                and not fd_entry_exists(destination_fd, destination_name)):
            restore_fd_copy(backup_fd, backup_name, destination_fd, destination_name)
        if (not state['receipt_persisted'] and fd_entry_exists(backup_fd, backup_name)
                and fd_entry_exists(destination_fd, destination_name)):
            remove_fd_entry(backup_fd, backup_name)
        if state.get('quarantine_name') and fd_entry_exists(backup_fd, state['quarantine_name']):
            remove_fd_entry(backup_fd, state['quarantine_name'])
        raise
    finally:
        if stage_fd is not None:
            try:
                if staged_name and fd_entry_exists(stage_fd, staged_name):
                    remove_fd_entry(stage_fd, staged_name)
            finally:
                os.close(stage_fd)
                if stage_name:
                    try:
                        os.rmdir(stage_name, dir_fd=destination_fd)
                    except FileNotFoundError:
                        pass
        os.close(backup_fd)
        os.close(destination_fd)


def is_ignored_distribution_name(name):
    """Return whether a generated/non-portable entry must be excluded."""
    return name == '__pycache__' or name.endswith('.pyc')


def ignore_distribution_entries(path, names):
    """Ignore generated Python bytecode during distributable copytree walks."""
    return {name for name in names if is_ignored_distribution_name(name)}


def hash_path(path, include_ignored=True):
    """Hash a file or directory deterministically, following source links.

    Source fingerprints use the distributable view with generated bytecode
    omitted. Destination ownership uses the complete view so an old receipt
    can prove ownership of a projection that still contains stale bytecode and
    the next update can replace it with a clean copy.
    """
    digest = hashlib.sha256()
    if os.path.islink(path):
        target = os.path.realpath(path)
        return hash_path(target, include_ignored)
    if not include_ignored and is_ignored_distribution_name(os.path.basename(path)):
        return ''
    if os.path.isfile(path):
        digest.update(b'file\0')
        with open(path, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b''):
                digest.update(chunk)
        return digest.hexdigest()
    if not os.path.isdir(path):
        return ''
    digest.update(b'dir\0')
    for name in sorted(os.listdir(path)):
        if not include_ignored and is_ignored_distribution_name(name):
            continue
        child = os.path.join(path, name)
        digest.update(name.replace(os.sep, '/').encode('utf-8'))
        digest.update(b'\0')
        digest.update(hash_path(child, include_ignored).encode('ascii'))
        digest.update(b'\0')
    return digest.hexdigest()


def safe_inventory_relative(relative, label):
    if not isinstance(relative, str) or not relative or '\x00' in relative or '\\' in relative:
        raise ValueError(f'{label} is not a valid relative path')
    normalized = os.path.normpath(relative).replace(os.sep, '/')
    if os.path.isabs(relative) or (len(relative) > 1 and relative[1] == ':') or normalized != relative or normalized in ('.', '..') or normalized.startswith('../'):
        raise ValueError(f'{label} escapes the plugin root: {relative}')
    return normalized


def inventory_supporting_sources():
    inventory_path = os.path.join(PLUGIN_ROOT, 'manifests', 'distribution-inventory.json')
    assets = None
    if os.path.isfile(inventory_path):
        try:
            with open(inventory_path, encoding='utf-8') as fh:
                assets = json.load(fh).get('supporting_assets')
        except Exception as exc:
            raise ValueError(f'cannot read distribution inventory: {exc}')
    if not isinstance(assets, list) or not assets:
        fallback = os.path.join(CODEX_SRC, 'config.toml.example')
        return {'config.toml.example': (fallback, 'config.toml.example')} if os.path.isfile(fallback) else {}

    result = {}
    for asset in assets:
        if not isinstance(asset, dict):
            raise ValueError('distribution inventory supporting asset is malformed')
        source_rel = safe_inventory_relative(asset.get('source'), 'supporting asset source')
        destination = safe_inventory_relative(asset.get('destination'), 'supporting asset destination')
        if destination in result:
            raise ValueError(f'duplicate supporting asset destination: {destination}')
        if HARNESS_KIND == 'cursor' and destination != 'dhpk' and not destination.startswith('dhpk/'):
            continue
        source = os.path.join(PLUGIN_ROOT, *source_rel.split('/'))
        if HARNESS_KIND == 'cursor':
            projected = os.path.join(PLUGIN_ROOT, SRC_REL, *destination.split('/'))
            if os.path.isfile(projected) and is_within(projected, PLUGIN_ROOT):
                source = projected
        if not is_within(source, PLUGIN_ROOT) or not lexists(source):
            raise ValueError(f'supporting asset source is missing or escapes the plugin root: {source_rel}')
        result[destination] = (source, destination)
    return result


def source_fingerprint():
    digest = hashlib.sha256()
    for root_name in SOURCE_KINDS:
        root = os.path.join(CODEX_SRC, root_name)
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            if is_ignored_distribution_name(name):
                continue
            metadata = inventory_skill_metadata() if root_name == 'skills' else {}
            if root_name == 'skills' and SELECTION_EMITTED_IDS is not None:
                stable_id = metadata.get(name, {}).get('id') if isinstance(metadata.get(name), dict) else None
                if stable_id not in SELECTION_EMITTED_IDS:
                    continue
            child = os.path.join(root, name)
            validate_source_tree(child, f'{root_name} source', allowed_roots=(PLUGIN_ROOT, INSTALLER_ROOT))
            digest.update(f'{root_name}/{name}'.encode('utf-8'))
            digest.update(b'\0')
            digest.update(hash_path(child, include_ignored=False).encode('ascii'))
            digest.update(b'\0')
    for relative, (supporting, destination) in sorted(inventory_supporting_sources().items()):
        validate_source_tree(supporting, 'supporting asset source')
        digest.update(destination.encode('utf-8'))
        digest.update(b'\0')
        digest.update(hash_path(supporting, include_ignored=False).encode('ascii'))
        digest.update(b'\0')
    return digest.hexdigest()


def read_plugin_version():
    path = os.path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh).get('version', 'unknown')
    except Exception:
        return 'unknown'


def inventory_skill_metadata():
    """Return current public skill names and stable identity metadata.

    Codex sync sources are the public-name projection under codex/skills. The
    distribution inventory is the only authority for stable ids and legacy
    names; missing/malformed inventory is treated as an empty metadata map and
    validated before any skill source can be materialized.
    """
    inventory_path = os.path.join(PLUGIN_ROOT, 'manifests', 'distribution-inventory.json')
    if not os.path.isfile(inventory_path):
        return {}
    try:
        with open(inventory_path, encoding='utf-8') as fh:
            inventory = json.load(fh)
    except Exception:
        return {}
    result = {}
    for skill in inventory.get('skills') or []:
        if not isinstance(skill, dict):
            continue
        name = skill.get('name')
        if not isinstance(name, str) or not name:
            continue
        result[name] = {
            'id': skill.get('id'),
            'name': name,
            'legacy_names': [legacy for legacy in (skill.get('legacy_names') or []) if isinstance(legacy, str) and legacy],
            'lifecycle': skill.get('lifecycle'),
            'tier': skill.get('tier'),
            'profiles': [value for value in (skill.get('profiles') or []) if isinstance(value, str)],
            'surfaces': [value for value in (skill.get('surfaces') or []) if isinstance(value, str)],
        }
    return result


def read_inventory_document():
    inventory_path = os.path.join(PLUGIN_ROOT, 'manifests', 'distribution-inventory.json')
    if not os.path.isfile(inventory_path):
        return None
    try:
        with open(inventory_path, encoding='utf-8') as fh:
            inventory = json.load(fh)
    except Exception as exc:
        raise ValueError(f'cannot read distribution inventory for capability selection: {exc}')
    if not isinstance(inventory, dict):
        raise ValueError('distribution inventory must be an object for capability selection')
    return inventory


def read_install_profiles():
    profiles_path = os.path.join(PLUGIN_ROOT, 'manifests', 'install-profiles.json')
    if not os.path.isfile(profiles_path):
        return None, None
    try:
        with open(profiles_path, encoding='utf-8') as fh:
            document = json.load(fh)
    except Exception as exc:
        raise ValueError(f'cannot read install profiles for capability selection: {exc}')
    table = document.get('profiles') if isinstance(document, dict) else None
    if not isinstance(table, dict):
        raise ValueError('install profiles must declare a profiles object')
    return document, table


def selection_digest(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(encoded.encode('utf-8')).hexdigest()


def resolve_installer_selection(receipt, metadata):
    """Resolve profile/overlay identity before any destination mutation.

    A clean install defaults to minimal.  A receipt without explicit profile
    metadata is intentionally treated as compat-v1, so merely running an
    update cannot shrink an existing projection.  Only --profile (and the
    accompanying --migrate gate below) may request a smaller replacement.
    """
    global SELECTION_PROFILE_ID, SELECTION_COMPATIBILITY, SELECTION_POLICY_VERSION
    global SELECTION_CANONICAL_IDS, SELECTION_EMITTED_IDS, SELECTION_FINGERPRINT
    global SELECTION_SURFACE_FINGERPRINT, SELECTION_MIGRATION
    inventory = read_inventory_document()
    profiles_document, profiles = read_install_profiles()
    if inventory is None or profiles is None:
        if PROFILE_EXPLICIT or REQUESTED_SKILL_IDS:
            raise ValueError('profile and skill selection requires distribution inventory and install profiles')
        return
    policy = inventory.get('profile_policy') if isinstance(inventory.get('profile_policy'), dict) else {}
    if not policy and not PROFILE_EXPLICIT and not REQUESTED_SKILL_IDS:
        return
    policy_version = policy.get('version') or profiles_document.get('selectionPolicyVersion') or 'dhpk.capability-bundle-selection.v1'
    by_id = {
        value.get('id'): value
        for value in metadata.values()
        if isinstance(value, dict) and isinstance(value.get('id'), str) and value.get('id')
    }
    retired = {
        row.get('id'): row
        for row in inventory.get('retired_skills') or []
        if isinstance(row, dict) and isinstance(row.get('id'), str)
    }
    if receipt and isinstance(receipt, dict) and isinstance(receipt.get('profileId'), str) and receipt.get('profileId'):
        default_profile = receipt.get('profileId')
    elif PROFILE_EXPLICIT:
        default_profile = REQUESTED_PROFILE_ID
    elif receipt or legacy:
        default_profile = 'compat-v1'
    else:
        # The long-lived project-local Codex sync route is a compatibility
        # surface.  Its clean default remains compat-v1 so existing projects
        # do not lose native Codex skills; callers can opt into the new
        # minimal bundle explicitly with --profile minimal.  The unified
        # distribution/lifecycle entry points default new package installs to
        # minimal.
        default_profile = 'compat-v1' if HARNESS_KIND == 'codex' else 'minimal'
    profile_id = REQUESTED_PROFILE_ID if PROFILE_EXPLICIT else default_profile
    if not isinstance(profile_id, str) or not re.match(r'^[A-Za-z0-9][A-Za-z0-9._-]*$', profile_id):
        raise ValueError('profile id must use a finite safe alias')
    profile = profiles.get(profile_id)
    if not isinstance(profile, dict):
        raise ValueError(f"unknown profile '{profile_id}'")
    declared = profile.get('skillIds')
    if profile_id == 'compat-v1':
        selected = sorted(by_id.keys())
    elif isinstance(declared, list):
        selected = list(declared)
    else:
        raise ValueError(f"profile '{profile_id}' must declare skillIds")
    if profile_id == 'minimal':
        required = policy.get('required_core_ids') if isinstance(policy.get('required_core_ids'), list) else []
        if len(selected) != 9 or len(required) != 9 or sorted(selected) != sorted(required):
            raise ValueError('minimal profile must declare exactly the nine inventory required core stable IDs')
    if len(set(selected)) != len(selected):
        raise ValueError(f"profile '{profile_id}' declares duplicate stable IDs")
    overlays = list(REQUESTED_SKILL_IDS)
    if len(set(overlays)) != len(overlays):
        raise ValueError('skill overlay contains duplicate stable IDs')
    surface_name = 'cursor-sync' if HARNESS_KIND == 'cursor' else 'codex-native'
    allowed = {
        key for key, value in by_id.items()
        if surface_name in (value.get('surfaces') or [])
    }
    for stable_id in selected:
        if stable_id in retired:
            raise ValueError(f"stable ID '{stable_id}' is retired")
        if stable_id not in by_id:
            raise ValueError(f"unknown stable ID '{stable_id}'")
        if by_id[stable_id].get('lifecycle') == 'deprecated':
            raise ValueError(f"stable ID '{stable_id}' is deprecated")
    for stable_id in overlays:
        if stable_id in retired:
            raise ValueError(f"stable ID '{stable_id}' is retired")
        if stable_id not in by_id:
            raise ValueError(f"unknown stable ID '{stable_id}'")
        if by_id[stable_id].get('lifecycle') == 'deprecated':
            raise ValueError(f"stable ID '{stable_id}' is deprecated")
        if stable_id not in allowed:
            raise ValueError(f"stable ID '{stable_id}' is not available on surface '{surface_name}'")
        excludes = set((profile.get('excludes') or {}).keys())
        if stable_id in excludes or excludes.intersection(set(by_id[stable_id].get('profiles') or [])):
            raise ValueError(f"stable ID '{stable_id}' is excluded by profile '{profile_id}'")
        selected.append(stable_id)
    # Preserve declared ordering for canonical identity.  Profile manifests
    # are authored in deterministic order; additive overlays append in CLI
    # order and therefore remain observable in the fingerprint.
    canonical = []
    for stable_id in selected:
        if stable_id not in canonical:
            canonical.append(stable_id)
    emitted = [stable_id for stable_id in canonical if stable_id in allowed]
    identity = {
        'schema': policy_version,
        'profileId': profile_id,
        'selectedStableIds': canonical,
        'compatibilityMode': 'compat-v1' if profile_id == 'compat-v1' else profile.get('compatibilityMode', 'profile'),
        'selectionPolicyVersion': policy_version,
        'sourceFingerprint': selection_digest({'profileId': profile_id, 'skillIds': overlays}),
        'profileFingerprint': selection_digest(profile),
        'inventoryFingerprint': selection_digest({
            'skills': list(metadata.values()),
            'retired_skills': inventory.get('retired_skills') or [],
        }),
    }
    selection_fingerprint = selection_digest(identity)
    surface_fingerprint = selection_digest({
        'selectionFingerprint': selection_fingerprint,
        'surface': surface_name,
        'emittedStableIds': emitted,
        'transform': {'id': 'identity', 'version': '1'},
    })
    SELECTION_PROFILE_ID = profile_id
    SELECTION_COMPATIBILITY = identity['compatibilityMode']
    SELECTION_POLICY_VERSION = policy_version
    SELECTION_CANONICAL_IDS = canonical
    SELECTION_EMITTED_IDS = emitted
    SELECTION_FINGERPRINT = selection_fingerprint
    SELECTION_SURFACE_FINGERPRINT = surface_fingerprint
    old_profile = receipt.get('profileId') if isinstance(receipt, dict) else None
    old_fingerprint = receipt.get('selectionFingerprint') if isinstance(receipt, dict) else None
    if PROFILE_EXPLICIT and (old_profile or old_fingerprint):
        SELECTION_MIGRATION = {
            'fromProfileId': old_profile or 'compat-v1',
            'toProfileId': profile_id,
            'fromSelectionFingerprint': old_fingerprint,
            'toSelectionFingerprint': selection_fingerprint,
        }


def inventory_retirement_metadata(active_metadata=None):
    """Return inventory-owned retirement rows keyed by every stable identity.

    Retirement rows are evidence only.  They are intentionally kept separate
    from ``inventory_skill_metadata`` so they can annotate reconciliation
    reports without ever becoming materializable Codex sources.
    """
    inventory_path = os.path.join(PLUGIN_ROOT, 'manifests', 'distribution-inventory.json')
    if not os.path.isfile(inventory_path):
        return {}
    try:
        with open(inventory_path, encoding='utf-8') as fh:
            inventory = json.load(fh)
    except Exception as exc:
        raise ValueError(f'cannot read distribution inventory for retirement metadata: {exc}')
    if not isinstance(inventory, dict) or 'retired_skills' not in inventory:
        return {}
    rows = inventory.get('retired_skills')
    if not isinstance(rows, list):
        raise ValueError('distribution inventory retired_skills must be an array')

    active_metadata = active_metadata if isinstance(active_metadata, dict) else {}
    active_ids = {
        record.get('id')
        for record in active_metadata.values()
        if isinstance(record, dict) and isinstance(record.get('id'), str)
    }
    active_names = {
        record.get('name')
        for record in active_metadata.values()
        if isinstance(record, dict) and isinstance(record.get('name'), str)
    }
    raw_agent_roster = inventory.get('agent_roster')
    if raw_agent_roster is not None and (
            not isinstance(raw_agent_roster, list)
            or any(not isinstance(agent_id, str) or not re.fullmatch(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', agent_id)
                   for agent_id in raw_agent_roster)
            or len(set(raw_agent_roster)) != len(raw_agent_roster)):
        raise ValueError('distribution inventory agent_roster is malformed')
    agent_roster = set(raw_agent_roster or [])
    row_fields = {
        'id', 'name', 'canonicalPath', 'priorSurfaces', 'retiredIn',
        'reasonCode', 'replacements', 'rollback',
    }
    safe_identifier = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
    public_name = re.compile(r'^dhpk-[a-z0-9]+(?:-[a-z0-9]+)*$')
    semver = re.compile(r'^\d+\.\d+\.\d+$')
    reason_code = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
    allowed_surfaces = {
        'claude-core', 'claude-module', 'codex-sync', 'codex-native',
        'agent-plugin', 'cursor-plugin', 'cursor-sync', 'agy-plugin',
    }
    seen_ids = set()
    seen_names = set()

    result = {}
    for index, row in enumerate(rows):
        prefix = f'retired_skills[{index}]'
        if not isinstance(row, dict):
            raise ValueError(f'{prefix} must be an object')
        unknown = sorted(set(row) - row_fields)
        if unknown:
            raise ValueError(f'{prefix} contains unknown fields: {", ".join(unknown)}')
        missing = sorted(row_fields - set(row))
        if missing:
            raise ValueError(f'{prefix} is missing required fields: {", ".join(missing)}')

        stable_id = row.get('id')
        name = row.get('name')
        canonical = row.get('canonicalPath')
        if not isinstance(stable_id, str) or not safe_identifier.fullmatch(stable_id):
            raise ValueError(f'{prefix}.id is not a safe identifier')
        if stable_id in seen_ids or stable_id in active_ids:
            raise ValueError(f'{prefix}.id overlaps an existing identity: {stable_id}')
        seen_ids.add(stable_id)
        if not isinstance(name, str) or len(name) > 63 or not public_name.fullmatch(name):
            raise ValueError(f'{prefix}.name is not a valid public skill name')
        if name in seen_names or name in active_names:
            raise ValueError(f'{prefix}.name overlaps an existing identity: {name}')
        seen_names.add(name)
        if canonical != f'skills/{name}':
            raise ValueError(f'{prefix}.canonicalPath must match skills/{name}')
        surfaces = row.get('priorSurfaces')
        if (not isinstance(surfaces, list) or not surfaces
                or any(not isinstance(surface, str) or surface not in allowed_surfaces for surface in surfaces)
                or len(set(surfaces)) != len(surfaces)):
            raise ValueError(f'{prefix}.priorSurfaces contains an unsupported or duplicate surface')
        retired_in = row.get('retiredIn')
        if not isinstance(retired_in, str) or not semver.fullmatch(retired_in):
            raise ValueError(f'{prefix}.retiredIn is malformed')
        reason = row.get('reasonCode')
        if not isinstance(reason, str) or not reason_code.fullmatch(reason):
            raise ValueError(f'{prefix}.reasonCode is malformed')

        raw_replacements = row.get('replacements')
        if not isinstance(raw_replacements, list) or not raw_replacements:
            raise ValueError(f'{prefix}.replacements must be a non-empty array')
        replacements = []
        for replacement_index, replacement in enumerate(raw_replacements):
            replacement_prefix = f'{prefix}.replacements[{replacement_index}]'
            if not isinstance(replacement, dict):
                raise ValueError(f'{replacement_prefix} must be an object')
            kind = replacement.get('kind')
            if kind not in ('skill', 'agent', 'model-default'):
                raise ValueError(f'{replacement_prefix}.kind is unsupported')
            allowed_replacement_fields = {'kind'} if kind == 'model-default' else {'kind', 'id', 'mode'}
            unknown_replacement = sorted(set(replacement) - allowed_replacement_fields)
            if unknown_replacement:
                raise ValueError(f'{replacement_prefix} contains unknown fields: {", ".join(unknown_replacement)}')
            if kind == 'model-default':
                if set(replacement) != {'kind'}:
                    raise ValueError(f'{replacement_prefix} model-default must not contain id or mode')
                replacements.append({'kind': kind})
                continue
            replacement_id = replacement.get('id')
            if not isinstance(replacement_id, str) or not safe_identifier.fullmatch(replacement_id):
                raise ValueError(f'{replacement_prefix}.id is not a safe identifier')
            if kind == 'skill' and replacement_id not in active_ids:
                raise ValueError(f'{replacement_prefix}.id is not an active skill: {replacement_id}')
            if kind == 'agent' and replacement_id not in agent_roster:
                raise ValueError(f'{replacement_prefix}.id is not an inventory-owned active agent: {replacement_id}')
            normalized_replacement = {'kind': kind, 'id': replacement_id}
            if 'mode' in replacement:
                mode = replacement.get('mode')
                if not isinstance(mode, str) or not safe_identifier.fullmatch(mode):
                    raise ValueError(f'{replacement_prefix}.mode is not a safe identifier')
                normalized_replacement['mode'] = mode
            replacements.append(normalized_replacement)

        rollback = row.get('rollback')
        if (not isinstance(rollback, dict) or set(rollback) != {'release'}
                or not isinstance(rollback.get('release'), str)
                or not semver.fullmatch(rollback.get('release'))):
            raise ValueError(f'{prefix}.rollback is malformed')
        identity = {
            'id': stable_id,
            'name': name,
            'canonicalPath': canonical,
        }
        evidence = {
            'id': stable_id,
            'name': name,
            'canonicalPath': canonical,
            'canonical_identity': dict(identity),
            'retiredIn': retired_in,
            'reasonCode': reason,
            'replacements': replacements,
            'rollback': {'release': rollback.get('release')},
        }
        keys = [stable_id, name, canonical, canonical.rsplit('/', 1)[-1]]
        for key in keys:
            result[key] = evidence
    return result


def retirement_for_entry(retirements, kind, name, old, relative):
    """Resolve a receipt entry to its ledger row without trusting its name."""
    if kind != 'skills' or not isinstance(retirements, dict):
        return None
    candidates = [name, relative]
    if isinstance(old, dict):
        candidates.extend((old.get('id'), old.get('name'), old.get('source'), old.get('destination')))
    for candidate in candidates:
        if isinstance(candidate, str) and candidate in retirements:
            return retirements[candidate]
    return None


def unique_retirement_rows(retirements):
    """Yield each ledger row once, preserving deterministic path ordering."""
    seen = set()
    rows = []
    for row in (retirements or {}).values():
        if not isinstance(row, dict):
            continue
        key = row.get('canonicalPath') or row.get('id') or row.get('name')
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
    return sorted(rows, key=lambda row: str(row.get('canonicalPath') or row.get('name') or ''))


def validate_skill_metadata(sources, metadata):
    """Fail closed when Codex skill sources lack schema-v3 identity fields.

    Supporting-only installs do not need inventory skill metadata, but every
    materialized skill entry must carry the stable inventory id and its exact
    public name. This keeps schema-v3 receipts self-describing instead of
    silently emitting legacy-shaped entries when a fixture or plugin ships a
    missing/malformed distribution inventory.
    """
    skill_names = sorted((sources.get('skills') or {}).keys())
    if not skill_names:
        return
    incomplete = []
    for name in skill_names:
        record = metadata.get(name) if isinstance(metadata, dict) else None
        if (not isinstance(record, dict)
                or not isinstance(record.get('id'), str)
                or not record.get('id').strip()
                or record.get('name') != name):
            incomplete.append(name)
    if incomplete:
        joined = ', '.join(incomplete)
        raise ValueError(f'distribution inventory skill metadata is missing or incomplete for Codex skill sources: {joined} (schema-v3 receipts require id and name)')


def read_receipt():
    ensure_manifest_safe()
    if not lexists(MANIFEST):
        return {}, False
    try:
        receipt = read_manifest_document()
    except Exception:
        return {}, True
    entries = receipt.get('managed_entries')
    return receipt, not isinstance(entries, dict)


def entry_map(receipt):
    managed = receipt.get('managed_entries') if isinstance(receipt, dict) else None
    managed = managed if isinstance(managed, dict) else {}
    result = {kind: dict(managed.get(kind) or {}) for kind in SOURCE_KINDS}
    result['supporting_assets'] = dict(managed.get('supporting_assets') or {})
    return result


def classify_receipt(receipt, malformed, sources, metadata, plugin_version, fingerprint):
    """Classify receipt/projection state before any destination mutation."""
    if not receipt and not malformed:
        return {
            'state': 'new',
            'requires_migration': False,
            'requires_structural_migration': False,
            'reasons': [],
            'legacy_names': [],
            'retired_names': [],
        }
    reasons = []
    legacy_names = []
    retired_names = []
    requires_migration = bool(malformed)
    if malformed:
        reasons.append('receipt is missing valid managed_entries or contains invalid JSON')
    schema = receipt.get('schema_version') if isinstance(receipt, dict) else None
    if schema != SCHEMA_VERSION:
        requires_migration = True
        reasons.append(f'receipt schema {schema if schema is not None else "<missing>"} requires schema-{SCHEMA_VERSION} migration')

    legacy_to_public = {}
    for public_name, skill in (metadata or {}).items():
        for legacy_name in skill.get('legacy_names') or []:
            legacy_to_public[legacy_name] = public_name
    managed = entry_map(receipt)
    canonical_names = set((sources.get('skills') or {}).keys())
    for key, entry in managed['skills'].items():
        relative = entry.get('source') or entry.get('destination') if isinstance(entry, dict) else ''
        basename = relative.split('/')[-1] if isinstance(relative, str) else ''
        if key in canonical_names and basename in ('', key):
            continue
        if key in legacy_to_public or basename in legacy_to_public:
            legacy_names.append(key)
            requires_migration = True
            reasons.append(f'legacy Codex skill name {key} shadows canonical {legacy_to_public.get(key) or legacy_to_public.get(basename)}')
        else:
            retired_names.append(key)

    if isinstance(receipt, dict) and receipt.get('legacy_pending'):
        requires_migration = True
        reasons.append('receipt has a pending legacy migration')
    requires_structural_migration = requires_migration
    if isinstance(receipt, dict) and receipt.get('plugin_version') != plugin_version:
        requires_migration = True
        reasons.append('receipt plugin version differs from source')
    if isinstance(receipt, dict) and receipt.get('source_fingerprint') != fingerprint:
        requires_migration = True
        reasons.append('receipt source fingerprint differs from the current Codex source')
    if isinstance(receipt, dict) and receipt.get('profileId') is not None:
        if receipt.get('profileId') != SELECTION_PROFILE_ID:
            requires_migration = True
            requires_structural_migration = True
            reasons.append('receipt capability profile differs from the requested profile')
        if receipt.get('selectionFingerprint') != SELECTION_FINGERPRINT:
            if not (SELECTION_PROFILE_ID == 'compat-v1' and not PROFILE_EXPLICIT):
                requires_migration = True
                requires_structural_migration = True
                reasons.append('receipt capability selection fingerprint differs from the current selection')
    elif isinstance(receipt, dict) and receipt and PROFILE_EXPLICIT and SELECTION_PROFILE_ID != 'compat-v1':
        requires_migration = True
        requires_structural_migration = True
        reasons.append('explicit profile migration is required for an unannotated compatibility receipt')
    elif isinstance(receipt, dict) and SELECTION_PROFILE_ID == 'compat-v1':
        # An unannotated schema-v3 receipt is deliberately retained as
        # compatibility state.  It is not a reason to prune or shrink output.
        pass
    return {
        'state': 'stale' if reasons else 'current',
        'requires_migration': requires_migration,
        'requires_structural_migration': requires_structural_migration,
        'reasons': reasons,
        'legacy_names': sorted(set(legacy_names)),
        'retired_names': sorted(set(retired_names)),
    }


def current_sources():
    result = {kind: {} for kind in MANAGED_KINDS}
    for kind in SOURCE_KINDS:
        root = os.path.join(CODEX_SRC, kind)
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            if is_ignored_distribution_name(name):
                continue
            metadata = inventory_skill_metadata() if kind == 'skills' else {}
            if kind == 'skills' and SELECTION_EMITTED_IDS is not None:
                stable_id = metadata.get(name, {}).get('id') if isinstance(metadata.get(name), dict) else None
                if stable_id not in SELECTION_EMITTED_IDS:
                    continue
            source = os.path.join(root, name)
            if not lexists(source):
                continue
            result[kind][name] = (source, f'{kind}/{name}')
    result['supporting_assets'].update(inventory_supporting_sources())
    return result


def target_for(relative):
    return safe_destination(relative)


def make_entry(source, relative, destination, metadata=None):
    source_fp = hash_path(source, include_ignored=False)
    destination_fp = hash_path(destination)
    marker = f'{MODE}:{relative}'
    entry = {
        'destination': relative,
        'source': relative,
        'mode': MODE,
        'source_fingerprint': source_fp,
        'destination_fingerprint': destination_fp,
        # `fingerprint` is the ownership fingerprint in schema v3. Keep the
        # source/destination-specific fields for backwards-compatible reads
        # and diagnostics.
        'fingerprint': destination_fp,
        'ownership_marker': marker,
    }
    if isinstance(metadata, dict):
        if metadata.get('id'):
            entry['id'] = metadata['id']
        if metadata.get('name'):
            entry['name'] = metadata['name']
    if MODE == 'symlink':
        entry['destination_target'] = os.readlink(destination)
    return entry


def contains_symlink(path):
    """Return True when a destination tree contains any symlink.

    Copy-mode ownership must not follow a link to prove content equality: a
    user can retarget that link to identical bytes and otherwise trick the
    receipt into deleting it during migration or uninstall. Walk with
    follow_symlinks=False so nested links and broken links fail closed.
    """
    if os.path.islink(path):
        return True
    if not os.path.isdir(path):
        return False
    try:
        with os.scandir(path) as children:
            for child in children:
                if child.is_symlink():
                    return True
                if child.is_dir(follow_symlinks=False) and contains_symlink(child.path):
                    return True
    except OSError:
        return True
    return False


def is_owned(entry, destination):
    if not isinstance(entry, dict) or entry.get('orphaned') or not lexists(destination):
        return False
    mode = entry.get('mode')
    relative = entry.get('source') or entry.get('destination')
    if not mode or not relative or entry.get('ownership_marker') != f'{mode}:{relative}':
        return False
    normalized = os.path.normpath(relative).replace(os.sep, '/')
    if os.path.isabs(relative) or normalized != relative or normalized == '..' or normalized.startswith('../'):
        return False
    if mode == 'symlink':
        recorded_target = entry.get('destination_target')
        return (os.path.islink(destination)
                and isinstance(recorded_target, str)
                and os.readlink(destination) == recorded_target)
    if contains_symlink(destination):
        return False
    recorded = entry.get('destination_fingerprint') or entry.get('fingerprint')
    if not isinstance(recorded, str) or not recorded:
        return False
    complete_destination = hash_path(destination)
    # Destination ownership always uses complete integrity. This accepts the
    # unfiltered fingerprint written by pre-remediation receipts and ensures
    # an ignored bytecode edit cannot be treated as an owned, unchanged target.
    return complete_destination == recorded


def recorded_copy_fingerprint(entry):
    """Return the receipt fingerprint used to guard copy-mode deletion."""
    if not isinstance(entry, dict) or entry.get('mode') == 'symlink':
        return None
    fingerprint = entry.get('destination_fingerprint') or entry.get('fingerprint')
    return fingerprint if isinstance(fingerprint, str) and len(fingerprint) == 64 else None


def exact_source_match(source, destination):
    if not lexists(destination):
        return False
    if os.path.islink(destination):
        return os.path.realpath(destination) == os.path.realpath(source)
    return hash_path(source, include_ignored=False) == hash_path(destination)


def hash_fd_entry(parent_fd, name, include_ignored=True):
    """Hash one directory entry after pinning it beneath an open parent fd."""
    entry_stat = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    digest = hashlib.sha256()
    if stat.S_ISLNK(entry_stat.st_mode):
        digest.update(b'symlink\0')
        digest.update(os.readlink(name, dir_fd=parent_fd).encode('utf-8'))
        return digest.hexdigest()
    if stat.S_ISREG(entry_stat.st_mode):
        if not include_ignored and is_ignored_distribution_name(name):
            return ''
        digest.update(b'file\0')
        file_fd = os.open(name, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0), dir_fd=parent_fd)
        try:
            while True:
                chunk = os.read(file_fd, 1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        finally:
            os.close(file_fd)
        return digest.hexdigest()
    if not stat.S_ISDIR(entry_stat.st_mode):
        return ''
    digest.update(b'dir\0')
    child_fd = os.open(name, _DIRECTORY_FLAGS, dir_fd=parent_fd)
    try:
        for child_name in sorted(os.listdir(child_fd)):
            if not include_ignored and is_ignored_distribution_name(child_name):
                continue
            digest.update(child_name.replace(os.sep, '/').encode('utf-8'))
            digest.update(b'\0')
            digest.update(hash_fd_entry(child_fd, child_name, include_ignored).encode('ascii'))
            digest.update(b'\0')
    finally:
        os.close(child_fd)
    return digest.hexdigest()


def hash_fd_directory(directory_fd, include_ignored=True):
    """Hash an already-open directory without reopening any path components."""
    digest = hashlib.sha256()
    digest.update(b'dir\0')
    for child_name in sorted(os.listdir(directory_fd)):
        if not include_ignored and is_ignored_distribution_name(child_name):
            continue
        digest.update(child_name.replace(os.sep, '/').encode('utf-8'))
        digest.update(b'\0')
        digest.update(hash_fd_entry(directory_fd, child_name, include_ignored).encode('ascii'))
        digest.update(b'\0')
    return digest.hexdigest()


def safe_destination_fingerprint(destination, include_ignored=True):
    """Hash a destination through descriptor-pinned, no-follow handles."""
    destination_abs = os.path.abspath(destination)
    root_abs = os.path.abspath(CODEX_ROOT)
    if destination_abs != root_abs and not destination_abs.startswith(root_abs + os.sep):
        raise ValueError(f'destination fingerprint escapes project {DEST_REL}: {destination}')
    relative = os.path.relpath(destination_abs, root_abs).replace(os.sep, '/')
    if relative == '.':
        root_fd = open_relative_directory('', create=False)
        try:
            return hash_fd_directory(root_fd, include_ignored)
        finally:
            os.close(root_fd)
    parent_relative, entry_name = os.path.split(relative)
    parent_fd = open_relative_directory(parent_relative, create=False)
    try:
        return hash_fd_entry(parent_fd, entry_name, include_ignored)
    except FileNotFoundError:
        return ''
    finally:
        os.close(parent_fd)


def build_plan(receipt, classification, sources, metadata, plugin_version, fingerprint, retirements=None):
    """Build a relative-path-only reconciliation report without writing state."""
    entries = entry_map(receipt)
    classification_reasons = [
        reason for reason in classification.get('reasons', [])
        if isinstance(reason, str)
    ]
    collisions = []
    missing = []
    updates = []
    retired = []
    for kind in MANAGED_KINDS:
        for name, (source, relative) in sources[kind].items():
            try:
                destination = target_for(relative)
            except ValueError as error:
                collisions.append({
                    'path': relative,
                    'kind': kind,
                    'name': name,
                    'ownership': 'unsafe-path',
                    'error': str(error),
                    'action': 'repair-source-inventory',
                })
                continue
            old = entries[kind].get(name)
            source_fp = hash_path(source, include_ignored=False)
            if not lexists(destination):
                missing.append({'path': relative, 'kind': kind, 'name': name, 'source_fingerprint': source_fp})
                continue
            destination_fp = safe_destination_fingerprint(destination)
            owned = is_owned(old, destination)
            if not owned:
                ownership = 'orphaned' if isinstance(old, dict) and old.get('orphaned') else 'unowned-collision'
                collisions.append({
                    'path': relative,
                    'kind': kind,
                    'name': name,
                    'ownership': ownership,
                    'source_fingerprint': source_fp,
                    'destination_fingerprint': destination_fp,
                    'action': f'--adopt={relative}@{destination_fp}@{source_fp}',
                })
                continue
            if old.get('mode') != MODE or not exact_source_match(source, destination):
                updates.append({
                    'path': relative,
                    'kind': kind,
                    'name': name,
                    'ownership': 'dhpk-managed',
                    'source_fingerprint': source_fp,
                    'destination_fingerprint': destination_fp,
                    'action': '--update',
                })
    for kind in MANAGED_KINDS:
        for name, old in entries[kind].items():
            if name in sources[kind]:
                continue
            relative = (old.get('destination') or old.get('source')) if isinstance(old, dict) else f'{kind}/{name}'
            retirement = retirement_for_entry(retirements, kind, name, old, relative)
            try:
                safe_destination(relative)
            except ValueError as error:
                item = {
                    'path': f'<unsafe-receipt-path:{kind}/{name}>',
                    'kind': kind,
                    'name': name,
                    'ownership': 'unsafe-receipt-path',
                    'source': old.get('source') if isinstance(old, dict) else relative,
                    'destination': relative,
                    'source_fingerprint': old.get('source_fingerprint', '') if isinstance(old, dict) else '',
                    'destination_fingerprint': old.get('destination_fingerprint') or old.get('fingerprint', '') if isinstance(old, dict) else '',
                    'error': str(error),
                    'action': 'repair-receipt',
                }
                if retirement:
                    item['retirement'] = dict(retirement)
                    item['canonical_identity'] = dict(retirement.get('canonical_identity') or {})
                item['fingerprints'] = {
                    'source': item.get('source_fingerprint', ''),
                    'destination': item.get('destination_fingerprint', ''),
                    'recorded_destination': item.get('destination_fingerprint', ''),
                    'observed_destination': '',
                }
                retired.append(item)
                continue
            destination = target_for(relative)
            source_fingerprint = old.get('source_fingerprint', '') if isinstance(old, dict) else ''
            recorded_destination_fingerprint = (
                old.get('destination_fingerprint') or old.get('fingerprint', '')
                if isinstance(old, dict) else ''
            )
            destination_fingerprint = recorded_destination_fingerprint
            observed_destination_fingerprint = ''
            ownership = 'missing'
            reason = 'retired-destination-missing'
            if lexists(destination):
                observed_destination_fingerprint = safe_destination_fingerprint(destination)
                destination_fingerprint = observed_destination_fingerprint
                if is_owned(old, destination):
                    ownership = 'receipt-entry'
                    reason = 'unchanged-receipt-owned'
                elif isinstance(old, dict) and old.get('orphaned'):
                    ownership = 'orphaned'
                    reason = 'already-orphaned'
                elif isinstance(old, dict) and old.get('mode') == 'symlink':
                    ownership = 'orphaned'
                    reason = 'retargeted-or-unsafe'
                else:
                    ownership = 'orphaned'
                    reason = 'modified-or-unowned'
            item = {
                'path': relative,
                'kind': kind,
                'name': name,
                'ownership': ownership,
                'source': old.get('source') if isinstance(old, dict) else relative,
                'destination': relative,
                'source_fingerprint': source_fingerprint,
                'destination_fingerprint': destination_fingerprint,
                'recorded_destination_fingerprint': recorded_destination_fingerprint,
                'observed_destination_fingerprint': observed_destination_fingerprint,
                'reason': reason,
                'action': 'prune' if ownership == 'receipt-entry' else 'preserve-orphan',
            }
            item['fingerprints'] = {
                'source': source_fingerprint,
                'destination': destination_fingerprint,
                'recorded_destination': recorded_destination_fingerprint,
                'observed_destination': observed_destination_fingerprint,
            }
            if retirement:
                item['retirement'] = dict(retirement)
                item['canonical_identity'] = dict(retirement.get('canonical_identity') or {})
            retired.append(item)

    # A ledger row can outlive its receipt entry.  If its former canonical
    # destination still exists, report it as an unowned collision rather than
    # treating a public name as permission to delete user data.
    receipt_retired_paths = set()
    for item in retired:
        retirement = item.get('retirement') if isinstance(item, dict) else None
        if isinstance(retirement, dict):
            path = retirement.get('canonicalPath')
            if isinstance(path, str):
                receipt_retired_paths.add(path)
    for retirement in unique_retirement_rows(retirements):
        relative = retirement.get('canonicalPath')
        if not isinstance(relative, str) or relative in receipt_retired_paths:
            continue
        try:
            destination = target_for(relative)
        except ValueError as error:
            retired.append({
                'path': relative,
                'kind': 'skills',
                'name': retirement.get('name'),
                'ownership': 'unsafe-retirement-path',
                'source': relative,
                'destination': relative,
                'source_fingerprint': '',
                'destination_fingerprint': '',
                'fingerprints': {
                    'source': '',
                    'destination': '',
                    'recorded_destination': '',
                    'observed_destination': '',
                },
                'error': str(error),
                'action': 'repair-retirement-ledger',
                'retirement': dict(retirement),
                'canonical_identity': dict(retirement.get('canonical_identity') or {}),
            })
            continue
        if not lexists(destination):
            continue
        destination_fingerprint = safe_destination_fingerprint(destination)
        retired.append({
            'path': relative,
            'kind': 'skills',
            'name': retirement.get('name'),
            'ownership': 'unowned-collision',
            'source': relative,
            'destination': relative,
            'source_fingerprint': '',
            'destination_fingerprint': destination_fingerprint,
            'fingerprints': {
                'source': '',
                'destination': destination_fingerprint,
                'recorded_destination': '',
                'observed_destination': destination_fingerprint,
            },
            'reason': 'retired-destination-unowned',
            'action': 'preserve-orphan',
            'retirement': dict(retirement),
            'canonical_identity': dict(retirement.get('canonical_identity') or {}),
        })
    reconciliation = receipt.get('reconciliation') if isinstance(receipt, dict) else {}
    reconciliation_state = reconciliation.get('state') if isinstance(reconciliation, dict) else None
    if reconciliation_state not in ('current', 'partial', 'stale'):
        reconciliation_state = receipt.get('state') if isinstance(receipt, dict) else None
    if reconciliation_state not in ('current', 'partial', 'stale'):
        reconciliation_state = classification.get('state')
    if collisions:
        state = 'requires_adoption'
    elif (classification.get('requires_migration')
          or classification.get('state') == 'stale'
          or reconciliation_state in ('partial', 'stale')
          or missing or updates or retired):
        state = 'stale'
    else:
        state = 'current'
    next_action = None
    if collisions:
        next_action = 'review collision evidence, then re-run with --update --adopt=<reported-relative-path>@<destination-fingerprint>@<source-fingerprint>'
    elif classification.get('requires_migration'):
        next_action = 're-run with --migrate --update'
    elif state != 'current':
        next_action = 're-run with --update (and --migrate when the receipt is legacy)'
    return {
        'schema_version': SCHEMA_VERSION,
        'plugin_version': plugin_version,
        'profileId': SELECTION_PROFILE_ID,
        'selectedStableIds': list(SELECTION_CANONICAL_IDS or []),
        'emittedStableIds': list(SELECTION_EMITTED_IDS or []),
        'compatibilityMode': SELECTION_COMPATIBILITY,
        'selectionPolicyVersion': SELECTION_POLICY_VERSION,
        'selectionFingerprint': SELECTION_FINGERPRINT,
        'surfaceSelectionFingerprint': SELECTION_SURFACE_FINGERPRINT,
        'receipt_state': reconciliation_state,
        'reconciliation_state': reconciliation_state,
        'state': state,
        'receipt_plugin_version': receipt.get('plugin_version') if isinstance(receipt, dict) else None,
        'receipt_source_fingerprint': receipt.get('source_fingerprint') if isinstance(receipt, dict) else None,
        'source_fingerprint': fingerprint,
        'reasons': classification_reasons,
        'collisions': sorted(collisions, key=lambda item: item.get('path', '')),
        'missing': sorted(missing, key=lambda item: item.get('path', '')),
        'updates': sorted(updates, key=lambda item: item.get('path', '')),
        'retired': sorted(retired, key=lambda item: item.get('path', '')),
        'next_action': next_action,
    }


def print_plan(report):
    if JSON_OUTPUT:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"[install-codex-skills] plan: state={report['state']} receipt_state={report['receipt_state']}")
        for collision in report['collisions']:
            print(
                '[install-codex-skills] collision: '
                f"{collision['path']} ownership={collision['ownership']} "
                f"action={collision['action']}"
            )
        if report.get('next_action'):
            print(f"[install-codex-skills] ACTION REQUIRED: {report['next_action']}")
    sys.exit(0 if report['state'] == 'current' else 1)


def validate_adoptions(plan):
    raw_requests = sorted(set(ADOPT_PATHS))
    if not raw_requests:
        return {}
    if not UPDATE:
        raise ValueError('--adopt requires --update')
    by_path = {item.get('path'): item for item in plan.get('collisions', [])}
    requested = {}
    for raw in raw_requests:
        parts = raw.rsplit('@', 2)
        if len(parts) != 3:
            raise ValueError('--adopt requires path@destination-fingerprint@source-fingerprint from a fresh plan')
        relative, expected, expected_source = parts
        for label, value in (('destination', expected), ('source', expected_source)):
            if len(value) != 64 or any(char not in '0123456789abcdefABCDEF' for char in value):
                raise ValueError(f'adoption {label} fingerprint is invalid: {relative}')
        destination = target_for(relative)
        item = by_path.get(relative)
        if item is None:
            raise ValueError(f'adoption path was not reported as a collision: {relative}')
        if os.path.islink(destination) or contains_symlink(destination):
            raise ValueError(f'adoption target contains a symlink: {relative}')
        current = safe_destination_fingerprint(destination)
        if (expected != item.get('destination_fingerprint')
                or expected_source != item.get('source_fingerprint')
                or current != expected):
            raise ValueError(f'adoption preflight changed: {relative}; run a fresh plan')
        requested[relative] = expected_source
    return requested


def install_descriptor_safe(source, destination, replace_existing=True):
    """Materialize one entry through descriptor-pinned destination parents."""
    relative = os.path.relpath(destination, CODEX_ROOT).replace(os.sep, '/')
    safe_destination(relative)
    validate_source_tree(source, 'install source', allowed_roots=(PLUGIN_ROOT, INSTALLER_ROOT))
    source_fingerprint = hash_path(source, include_ignored=False)
    parent_relative, destination_name = os.path.split(relative)
    destination_fd = open_relative_directory(parent_relative, create=True)
    stage_fd = None
    stage_name = None
    staged_name = None
    try:
        stage_name, stage_fd, staged_name, staged = stage_materialization(source, destination, destination_fd)
        if hash_path(source, include_ignored=False) != source_fingerprint:
            raise ValueError(f'install source changed during materialization: {relative}; run a fresh update')
        if hash_path(staged, include_ignored=False) != source_fingerprint:
            raise ValueError(f'install materialization changed: {relative}; run a fresh update')
        if fd_entry_exists(destination_fd, destination_name):
            if not replace_existing:
                raise ValueError(f'install destination already exists: {relative}')
            remove_fd_entry(destination_fd, destination_name)
        os.replace(staged_name, destination_name, src_dir_fd=stage_fd, dst_dir_fd=destination_fd)
        os.fsync(destination_fd)
    finally:
        if stage_fd is not None:
            try:
                if staged_name and fd_entry_exists(stage_fd, staged_name):
                    remove_fd_entry(stage_fd, staged_name)
            finally:
                os.close(stage_fd)
                if stage_name:
                    try:
                        os.rmdir(stage_name, dir_fd=destination_fd)
                    except FileNotFoundError:
                        pass
        os.close(destination_fd)


def install(source, destination):
    install_descriptor_safe(source, destination, replace_existing=True)


def install_atomic(source, destination):
    """Stage a fresh destination beside its final path, then publish it.

    The migration path uses this helper so an unchanged legacy destination is
    not removed until the new public-name entry has been materialized. A
    pre-existing destination is never removed here; callers must first prove
    it is receipt-owned and unchanged.
    """
    install_descriptor_safe(source, destination, replace_existing=False)


def build_evidence(plugin_version, fingerprint, entries, counts, state):
    destinations = {}
    ownership = dict(evidence_ownership)
    for kind in MANAGED_KINDS:
        for name, entry in entries.get(kind, {}).items():
            if not isinstance(entry, dict):
                continue
            relative = entry.get('destination') or entry.get('source')
            if not isinstance(relative, str) or not relative:
                continue
            destinations[relative] = {
                'source': entry.get('source'),
                'destination': relative,
                'source_fingerprint': entry.get('source_fingerprint', ''),
                'destination_fingerprint': entry.get('destination_fingerprint') or entry.get('fingerprint', ''),
            }
            ownership.setdefault(relative, 'orphaned' if entry.get('orphaned') else 'dhpk-managed')
    paths = {
        'source_root': SRC_REL,
        'destination_root': DEST_REL,
        'receipt': f'{DEST_REL}/.dhpk-installed.json',
    }
    for kind, values in evidence_paths.items():
        paths[kind] = sorted(set(values))
    evidence = {
        'schema_version': SCHEMA_VERSION,
        'plugin_version': plugin_version,
        'state': state,
        'complete': state == 'current',
        'paths': paths,
        'ownership': ownership,
        'fingerprints': {
            'source': fingerprint,
            'destinations': destinations,
        },
        'backups': list(backup_records),
    }
    if SELECTION_PROFILE_ID:
        evidence['selection'] = {
            'profileId': SELECTION_PROFILE_ID,
            'selectedStableIds': list(SELECTION_CANONICAL_IDS or []),
            'emittedStableIds': list(SELECTION_EMITTED_IDS or []),
            'compatibilityMode': SELECTION_COMPATIBILITY,
            'selectionPolicyVersion': SELECTION_POLICY_VERSION,
            'selectionFingerprint': SELECTION_FINGERPRINT,
            'surfaceSelectionFingerprint': SELECTION_SURFACE_FINGERPRINT,
        }
    return evidence


def save_receipt(plugin_version, fingerprint, entries, orphaned, counts, legacy_pending=False, state=None):
    ensure_manifest_safe()
    if state is None:
        if legacy_pending:
            state = 'stale'
        elif counts.get('skipped_collision') or counts.get('orphaned'):
            state = 'partial'
        else:
            state = 'current'
    durable_counts = dict(counts)
    # Keep the historical skipped_collision/pruned keys while exposing the
    # action-oriented aliases used by release evidence and operators.
    durable_counts['collided'] = durable_counts.get('skipped_collision', 0)
    durable_counts['retired'] = durable_counts.get('retired', durable_counts.get('pruned', 0))
    durable_counts['backed_up'] = durable_counts.get('backed_up', len(backup_records))
    durable_counts['state'] = state
    durable_counts['status'] = state
    durable_counts['complete'] = state == 'current'
    durable_counts['evidence'] = build_evidence(plugin_version, fingerprint, entries, durable_counts, state)
    receipt = {
        'schema_version': SCHEMA_VERSION,
        'plugin_version': plugin_version,
        'source_fingerprint': fingerprint,
        'mode': MODE,
        'installed_at': datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + 'Z',
        'managed_entries': entries,
        'orphaned_entries': orphaned,
        'reconciliation': durable_counts,
        'state': state,
    }
    if SELECTION_PROFILE_ID:
        receipt.update({
            'profileId': SELECTION_PROFILE_ID,
            'selectedStableIds': list(SELECTION_CANONICAL_IDS or []),
            'emittedStableIds': list(SELECTION_EMITTED_IDS or []),
            'compatibilityMode': SELECTION_COMPATIBILITY,
            'selectionPolicyVersion': SELECTION_POLICY_VERSION,
            'selectionFingerprint': SELECTION_FINGERPRINT,
            'surfaceSelectionFingerprint': SELECTION_SURFACE_FINGERPRINT,
        })
        if SELECTION_MIGRATION:
            receipt['migration'] = dict(SELECTION_MIGRATION)
    if isinstance(TRANSACTION_JOURNAL, dict):
        receipt['transaction_id'] = TRANSACTION_JOURNAL.get('run')
        receipt['transaction_final'] = TRANSACTION_RECEIPT_FINAL
    if legacy_pending:
        receipt['legacy_pending'] = True
    if FAIL_RECEIPT_FOR_TEST and state != 'partial':
        raise OSError('test-injected receipt commit failure')
    root_fd = open_relative_directory('', create=True)
    temporary_name = f'.dhpk-installed.json.{uuid.uuid4().hex}'
    try:
        fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0),
            0o600,
            dir_fd=root_fd,
        )
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(receipt, fh, indent=2, sort_keys=True)
            fh.write('\n')
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary_name, os.path.basename(MANIFEST), src_dir_fd=root_fd, dst_dir_fd=root_fd)
        try:
            os.fsync(root_fd)
        except OSError as error:
            raise ReceiptCommitError(
                f'receipt committed but directory durability failed: {error}',
                committed=True,
            )
    finally:
        try:
            os.unlink(temporary_name, dir_fd=root_fd)
        except FileNotFoundError:
            pass
        os.close(root_fd)
    return receipt


def save_receipt_with_prune_rollback(plugin_version, fingerprint, entries, orphaned, counts,
                                     legacy_pending=False, state=None, transaction_final=True):
    """Publish the receipt and roll back every staged mutation on failure."""
    global TRANSACTION_RECEIPT_FINAL
    prior_transaction_final = TRANSACTION_RECEIPT_FINAL
    TRANSACTION_RECEIPT_FINAL = transaction_final
    try:
        receipt = save_receipt(
            plugin_version,
            fingerprint,
            entries,
            orphaned,
            counts,
            legacy_pending=legacy_pending,
            state=state,
        )
        if transaction_final:
            try:
                finish_transaction('committed')
            except Exception as error:
                # The receipt is already durable.  Keep the journal active so
                # the next invocation can reconcile it against transaction_id
                # instead of attempting to roll back a committed projection.
                clear_pending_transactions()
                raise ReceiptCommitError(
                    f'receipt committed but transaction journal durability failed: {error}',
                    committed=True,
                )
        if transaction_final:
            clear_pending_transactions()
        return receipt
    except ReceiptCommitError as error:
        if error.committed and transaction_final:
            clear_pending_transactions()
        elif not error.committed:
            rollback_pending()
        raise
    except Exception:
        rollback_pending()
        raise
    finally:
        TRANSACTION_RECEIPT_FINAL = prior_transaction_final


def print_summary(counts, collisions, orphaned):
    print('[install-codex-skills] reconciliation: ' + ', '.join(f'{k}={counts[k]}' for k in (
        'created', 'updated', 'adopted', 'migrated', 'preserved', 'skipped_collision', 'collided',
        'pruned', 'retired', 'backed_up', 'orphaned')))
    for relative in sorted(collisions):
        print(f'[install-codex-skills] collision preserved: {relative}')
    for relative in sorted(orphaned):
        print(f'[install-codex-skills] orphaned preserved: {relative}')


def migrate_legacy_skill_names(entries, orphaned, counts, collisions, sources, metadata):
    """Adopt receipt-owned legacy skill destinations under their public names.

    A legacy destination is removable only when its receipt entry still owns
    the unchanged target. Every other shape is retained as an orphan/conflict:
    edited content, unowned/third-party paths, retargeted links, malformed
    entries, and ambiguous inventory mappings all fail closed.
    """
    legacy_to_public = {}
    ambiguous = set()
    for public_name, skill in metadata.items():
        for legacy_name in skill.get('legacy_names') or []:
            if legacy_name == public_name:
                continue
            prior = legacy_to_public.get(legacy_name)
            if prior and prior != public_name:
                ambiguous.add(legacy_name)
            else:
                legacy_to_public[legacy_name] = public_name

    def receipt_matches(legacy_name):
        relative = f'skills/{legacy_name}'
        matches = []
        for key, value in entries['skills'].items():
            if key == legacy_name or (isinstance(value, dict) and (value.get('destination') == relative or value.get('source') == relative)):
                matches.append((key, value))
        return matches

    def conflict(key, old, relative, reason):
        preserved = dict(old) if isinstance(old, dict) else {'destination': relative, 'source': relative}
        preserved['orphaned'] = True
        entries['skills'][key] = preserved
        orphaned[relative] = dict(preserved, reason=reason)
        if relative not in collisions:
            collisions.append(relative)
        counts['skipped_collision'] += 1
        counts['preserved'] += 1
        counts['orphaned'] += 1
        record_path('collisions', relative)
        record_path('orphaned', relative)
        record_ownership(relative, 'unowned-collision')
        print(f'[install-codex-skills] legacy conflict preserved: {relative} ({reason})')

    for legacy_name, public_name in sorted(legacy_to_public.items()):
        relative = f'skills/{legacy_name}'
        matches = receipt_matches(legacy_name)
        if not matches:
            try:
                legacy_destination = target_for(relative)
            except ValueError:
                legacy_destination = None
            if legacy_destination is not None and lexists(legacy_destination):
                if relative not in collisions:
                    collisions.append(relative)
                counts['skipped_collision'] += 1
                counts['preserved'] += 1
                record_path('collisions', relative)
                record_ownership(relative, 'unowned-collision')
                print(f'[install-codex-skills] legacy conflict preserved: {relative} (destination is unowned or has no receipt ownership)')
            continue
        if legacy_name in ambiguous or len(matches) != 1:
            if matches:
                for key, old in matches:
                    conflict(key, old, relative, 'ambiguous legacy inventory mapping')
            continue
        key, old = matches[0]
        try:
            old_destination = receipt_destination('skills', key, old)
            new_relative = f'skills/{public_name}'
            new_destination = target_for(new_relative)
            source = sources['skills'].get(public_name, (None, new_relative))[0]
            if source is None or not lexists(source):
                conflict(key, old, relative, 'current public skill source is missing')
                continue
            if not lexists(old_destination):
                conflict(key, old, relative, 'legacy destination is missing')
                continue
            if not is_owned(old, old_destination):
                conflict(key, old, relative, 'legacy destination is edited, unowned, or retargeted')
                continue

            current_entry = entries['skills'].get(public_name)
            if lexists(new_destination):
                if not (isinstance(current_entry, dict) and is_owned(current_entry, new_destination)):
                    conflict(key, old, relative, f'current public destination already exists: {new_relative}')
                    continue
                backup = backup_destination(relative, old_destination, 'legacy-migration')
                if backup:
                    counts['backed_up'] += 1
                    register_pending_prune(relative, old_destination, backup)
                remove_relative_path(relative, recorded_copy_fingerprint(old))
                if key != public_name:
                    del entries['skills'][key]
                entries['skills'][public_name] = make_entry(source, new_relative, new_destination, metadata.get(public_name))
                clear_orphaned(relative, new_relative)
                counts['migrated'] += 1
                record_path('migrated', relative)
                record_path('migrated', new_relative)
                record_ownership(new_relative, 'dhpk-managed')
                continue

            backup = backup_destination(relative, old_destination, 'legacy-migration')
            if backup:
                counts['backed_up'] += 1
                register_pending_prune(relative, old_destination, backup)
            register_pending_mutation(
                new_relative,
                new_destination,
                None,
                hash_path(source, include_ignored=False),
            )
            # Publish the new destination first. Only after it is visible do we
            # remove the unchanged legacy path, preserving rollback safety.
            install_atomic(source, new_destination)
            remove_relative_path(relative, recorded_copy_fingerprint(old))
            if key != public_name:
                del entries['skills'][key]
            entries['skills'][public_name] = make_entry(source, new_relative, new_destination, metadata.get(public_name))
            clear_orphaned(relative, new_relative)
            counts['migrated'] += 1
            record_path('migrated', relative)
            record_path('migrated', new_relative)
            record_ownership(new_relative, 'dhpk-managed')
        except ValueError as error:
            conflict(key, old, relative, str(error))


try:
    ensure_codex_root_safe()
    if PLAN:
        plan_blockers = inspect_stale_transactions_for_plan()
        if plan_blockers:
            blocked_report = {
                'schema_version': SCHEMA_VERSION,
                'state': 'blocked',
                'receipt_state': 'blocked',
                'next_action': 're-run without --plan so the interrupted transaction can be recovered under the project lock',
                'blocking_recovery': plan_blockers,
            }
            if JSON_OUTPUT:
                print(json.dumps(blocked_report, indent=2, sort_keys=True))
            else:
                print('[install-codex-skills] BLOCKED: ' + '; '.join(plan_blockers))
                print('[install-codex-skills] ACTION REQUIRED: ' + blocked_report['next_action'])
            sys.exit(2)
    else:
        acquire_install_lock()
        recover_stale_transactions()
except (OSError, ValueError) as error:
    print(f'[install-codex-skills] ERROR: transaction recovery failed: {error}', file=sys.stderr)
    sys.exit(2)

plugin_version = read_plugin_version()
try:
    receipt, legacy = read_receipt()
except ValueError as error:
    print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
    sys.exit(2)
try:
    skill_metadata = inventory_skill_metadata()
    resolve_installer_selection(receipt, skill_metadata)
    sources = current_sources()
    skill_retirements = inventory_retirement_metadata(skill_metadata)
    validate_skill_metadata(sources, skill_metadata)
except ValueError as error:
    print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
    sys.exit(2)
fingerprint = source_fingerprint()

if ADOPT_PATHS:
    recorded_mode = receipt.get('mode') if isinstance(receipt, dict) else None
    if recorded_mode not in ('symlink', 'copy'):
        print('[install-codex-skills] ERROR: --adopt requires a schema-v3 receipt with a recorded projection mode', file=sys.stderr)
        sys.exit(2)
    if MODE_EXPLICIT and MODE != recorded_mode:
        print(
            f'[install-codex-skills] ERROR: --adopt mode mismatch: receipt uses {recorded_mode}, requested {MODE}; omit --copy or use the recorded mode',
            file=sys.stderr,
        )
        sys.exit(2)
    if not MODE_EXPLICIT:
        # A path-scoped adoption must not turn a symlink projection into a
        # copy projection (or vice versa) for unrelated managed entries.
        MODE = recorded_mode

classification = classify_receipt(receipt, legacy, sources, skill_metadata, plugin_version, fingerprint)
legacy_pending = bool(
    legacy
    or classification.get('requires_structural_migration')
    or (isinstance(receipt, dict) and receipt.get('legacy_pending'))
)
entries = entry_map(receipt)
orphaned = dict(receipt.get('orphaned_entries') or {}) if isinstance(receipt, dict) else {}
counts = {k: 0 for k in (
    'created', 'updated', 'adopted', 'migrated', 'preserved', 'skipped_collision', 'collided',
    'pruned', 'retired', 'backed_up', 'orphaned',
)}
collisions = []


def clear_orphaned(*relatives):
    for relative in relatives:
        if isinstance(relative, str) and relative:
            orphaned.pop(relative, None)


plan = build_plan(receipt, classification, sources, skill_metadata, plugin_version, fingerprint, skill_retirements)
if PLAN:
    print_plan(plan)
try:
    adopt_paths = validate_adoptions(plan)
except ValueError as error:
    print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
    sys.exit(2)

if classification.get('requires_structural_migration') and not MIGRATE and UNINSTALL is False:
    print('[install-codex-skills] state=stale_receipt: explicit migration is required before changing this projection', file=sys.stderr)
    for reason in classification.get('reasons') or []:
        print(f'[install-codex-skills] stale evidence: {reason}', file=sys.stderr)
    mode_hint = '--copy ' if MODE == 'copy' else ''
    print(
        '[install-codex-skills] ACTION REQUIRED: '
        f'bash {INSTALLER_SCRIPT} {mode_hint}--migrate --update --force',
        file=sys.stderr,
    )
    sys.exit(2)

prior_reconciliation = receipt.get('reconciliation') if isinstance(receipt, dict) else {}
has_pending_conflicts = bool(orphaned) or bool(isinstance(prior_reconciliation, dict) and prior_reconciliation.get('skipped_collision'))
if not UPDATE and not MIGRATE and not UNINSTALL and not legacy and not has_pending_conflicts and receipt.get('plugin_version') == plugin_version and receipt.get('source_fingerprint') == fingerprint:
    print(f'[install-codex-skills] already up-to-date for dhpk v{plugin_version}')
    sys.exit(0)

try:
    begin_transaction(
        plugin_version,
        fingerprint,
        receipt_snapshot=receipt,
        receipt_snapshot_present=lexists(MANIFEST),
    )
except (OSError, ValueError) as error:
    print(f'[install-codex-skills] ERROR: cannot start transaction journal: {error}', file=sys.stderr)
    sys.exit(2)

if UNINSTALL:
    try:
        ensure_codex_root_safe()
    except ValueError as error:
        print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
        sys.exit(2)
    if not entries and not orphaned:
        try:
            archive_receipt_for_uninstall()
            finish_transaction('committed')
            clear_pending_transactions()
            print('[install-codex-skills] no managed receipt entries to uninstall')
            sys.exit(0)
        except ReceiptCommitError as error:
            rollback_errors = rollback_pending()
            if rollback_errors:
                print('[install-codex-skills] ERROR: uninstall receipt rollback is incomplete; manual recovery required: ' + '; '.join(rollback_errors), file=sys.stderr)
            print(f'[install-codex-skills] ERROR: uninstall receipt quarantine committed but durability flush failed: {error}', file=sys.stderr)
            sys.exit(2)
        except Exception as error:
            rollback_pending()
            print(f'[install-codex-skills] ERROR: uninstall receipt quarantine failed: {error}', file=sys.stderr)
            sys.exit(2)
    remaining = {kind: {} for kind in MANAGED_KINDS}
    try:
        for kind in MANAGED_KINDS:
            for name, old in entries[kind].items():
                relative = (old.get('destination') or old.get('source')) if isinstance(old, dict) else f'{kind}/{name}'
                relative = relative or f'{kind}/{name}'
                try:
                    destination = receipt_destination(kind, name, old)
                except ValueError as error:
                    remaining[kind][name] = dict(old, orphaned=True) if isinstance(old, dict) else {'destination': relative, 'orphaned': True}
                    orphaned[relative] = dict(remaining[kind][name], reason='unsafe-receipt-path')
                    counts['orphaned'] += 1
                    print(f'[install-codex-skills] orphaned preserved: {relative} ({error})')
                    continue
                if is_owned(old, destination):
                    backup = backup_destination(relative, destination, 'uninstall')
                    if backup:
                        register_pending_prune(relative, destination, backup)
                        counts['backed_up'] += 1
                    remove_relative_path(relative, recorded_copy_fingerprint(old))
                    counts['pruned'] += 1
                    counts['retired'] += 1
                    record_path('retired', relative)
                    record_ownership(relative, 'dhpk-managed')
                else:
                    remaining[kind][name] = dict(old, orphaned=True)
                    orphaned[relative] = dict(old, reason='modified-before-uninstall')
                    counts['orphaned'] += 1
                    record_path('orphaned', relative)
                    record_ownership(relative, 'orphaned')
        if not orphaned and not any(remaining[kind] for kind in remaining):
            archive_receipt_for_uninstall()
            finish_transaction('committed')
            clear_pending_transactions()
        else:
            save_receipt_with_prune_rollback(
                plugin_version,
                fingerprint,
                remaining,
                orphaned,
                counts,
                legacy_pending=legacy_pending,
            )
    except ReceiptCommitError as error:
        if (isinstance(TRANSACTION_JOURNAL, dict)
                and TRANSACTION_JOURNAL.get('receipt_archive')):
            rollback_pending()
        print(f'[install-codex-skills] ERROR: uninstall receipt commit completed but durability flush failed: {error}', file=sys.stderr)
        sys.exit(2)
    except Exception as error:
        rollback_pending()
        print(f'[install-codex-skills] ERROR: uninstall failed; removed entries restored where possible: {error}', file=sys.stderr)
        sys.exit(2)
    print_summary(counts, collisions, sorted(orphaned))
    sys.exit(0)

try:
    ensure_codex_root_safe()
except ValueError as error:
    print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
    sys.exit(2)
for kind in sorted(set(SOURCE_KINDS) | {'skills', 'agents'}):
    directory_fd = open_relative_directory(kind, create=True)
    os.close(directory_fd)

# Public-name migration must run before the generic update-prune pass: an old
# receipt key is not a current source name, but it remains protected when the
# inventory migration cannot prove ownership.
if (UPDATE or MIGRATE) and not ADOPT_PATHS:
    migrate_legacy_skill_names(entries, orphaned, counts, collisions, sources, skill_metadata)

# Reconcile entries removed from the source only during an explicit update.
if UPDATE and not ADOPT_PATHS:
    for kind in MANAGED_KINDS:
        for name in list(entries[kind]):
            if name in sources[kind]:
                continue
            old = entries[kind][name]
            relative = (old.get('destination') or old.get('source')) if isinstance(old, dict) else f'{kind}/{name}'
            relative = relative or f'{kind}/{name}'
            retirement = retirement_for_entry(skill_retirements, kind, name, old, relative)
            try:
                destination = receipt_destination(kind, name, old)
            except ValueError as error:
                entries[kind][name] = dict(old, orphaned=True) if isinstance(old, dict) else {'destination': relative, 'orphaned': True}
                orphaned_entry = dict(entries[kind][name], reason='unsafe-receipt-path')
                if retirement:
                    orphaned_entry['retirement'] = dict(retirement)
                orphaned[relative] = orphaned_entry
                counts['orphaned'] += 1
                counts['preserved'] += 1
                counts['skipped_collision'] += 1
                if relative not in collisions:
                    collisions.append(relative)
                record_path('collisions', relative)
                record_path('orphaned', relative)
                record_ownership(relative, 'unsafe-receipt-path')
                print(f'[install-codex-skills] orphaned preserved: {relative} ({error})')
                continue
            if not lexists(destination):
                if retirement:
                    entries[kind][name] = dict(old, orphaned=True)
                    orphaned_entry = dict(old, reason='retired-destination-missing')
                    orphaned_entry['retirement'] = dict(retirement)
                    orphaned[relative] = orphaned_entry
                    counts['orphaned'] += 1
                    counts['preserved'] += 1
                    counts['skipped_collision'] += 1
                    if relative not in collisions:
                        collisions.append(relative)
                    record_path('collisions', relative)
                    record_path('orphaned', relative)
                    record_ownership(relative, 'missing')
                else:
                    del entries[kind][name]
                    clear_orphaned(relative)
            elif is_owned(old, destination):
                backup = backup_destination(relative, destination, 'retired-entry')
                if backup:
                    counts['backed_up'] += 1
                    register_pending_prune(relative, destination, backup)
                remove_relative_path(relative, recorded_copy_fingerprint(old))
                del entries[kind][name]
                counts['pruned'] += 1
                counts['retired'] += 1
                record_path('retired', relative)
                record_ownership(relative, 'dhpk-managed')
            else:
                entries[kind][name] = dict(old, orphaned=True)
                orphaned_entry = dict(old, reason='modified-removed-source')
                if retirement:
                    orphaned_entry['reason'] = 'retired-entry-modified-or-retargeted'
                    orphaned_entry['retirement'] = dict(retirement)
                orphaned[relative] = orphaned_entry
                counts['orphaned'] += 1
                counts['preserved'] += 1
                counts['skipped_collision'] += 1
                if relative not in collisions:
                    collisions.append(relative)
                record_path('collisions', relative)
                record_path('orphaned', relative)
                record_ownership(relative, 'retired-orphaned' if retirement else 'orphaned')

    # Preserve retired destinations that are present on disk but have no
    # receipt entry proving ownership.  The ledger is guidance, never a
    # deletion authority.
    represented_retirements = set()
    for kind in MANAGED_KINDS:
        for name, old in entries[kind].items():
            relative = (old.get('destination') or old.get('source')) if isinstance(old, dict) else ''
            retirement = retirement_for_entry(skill_retirements, kind, name, old, relative)
            if retirement:
                represented_retirements.add(retirement.get('canonicalPath'))
    for retirement in unique_retirement_rows(skill_retirements):
        relative = retirement.get('canonicalPath')
        if not isinstance(relative, str) or relative in represented_retirements:
            continue
        try:
            destination = target_for(relative)
        except ValueError as error:
            orphaned_entry = {
                'destination': relative,
                'source': relative,
                'reason': 'unsafe-retirement-path',
                'retirement': dict(retirement),
                'orphaned': True,
            }
            orphaned[relative] = orphaned_entry
            counts['orphaned'] += 1
            counts['preserved'] += 1
            counts['skipped_collision'] += 1
            collisions.append(relative)
            record_path('collisions', relative)
            record_path('orphaned', relative)
            record_ownership(relative, 'unsafe-retirement-path')
            print(f'[install-codex-skills] orphaned preserved: {relative} ({error})')
            continue
        if not lexists(destination):
            continue
        orphaned_entry = {
            'destination': relative,
            'source': relative,
            'reason': 'retired-destination-unowned',
            'destination_fingerprint': safe_destination_fingerprint(destination),
            'retirement': dict(retirement),
            'orphaned': True,
        }
        orphaned[relative] = orphaned_entry
        counts['orphaned'] += 1
        counts['preserved'] += 1
        counts['skipped_collision'] += 1
        collisions.append(relative)
        record_path('collisions', relative)
        record_path('orphaned', relative)
        record_ownership(relative, 'unowned-collision')

for kind in MANAGED_KINDS:
    for name, (source, relative) in sources[kind].items():
        try:
            destination = target_for(relative)
        except ValueError as error:
            rollback_pending()
            print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
            sys.exit(2)
        old = entries[kind].get(name)
        if ADOPT_PATHS and relative not in adopt_paths:
            # An explicit adoption authorizes only the reported paths. Leave
            # every unrelated source entry, including missing, stale-owned,
            # and unowned targets, unchanged for a later normal update.
            if (not lexists(destination)
                    or not is_owned(old, destination)
                    or old.get('mode') != MODE
                    or not exact_source_match(source, destination)):
                record_path('deferred', relative)
                if relative not in collisions:
                    collisions.append(relative)
                    counts['skipped_collision'] += 1
                    counts['preserved'] += 1
                    record_path('collisions', relative)
                    record_ownership(relative, 'deferred-adoption')
            continue
        if lexists(destination):
            owned = is_owned(old, destination)
            adopted = False
            if legacy_pending and MIGRATE and exact_source_match(source, destination):
                entries[kind][name] = make_entry(source, relative, destination, skill_metadata.get(name) if kind == 'skills' else None)
                adopted = True
                counts['preserved'] += 1
            if adopted:
                clear_orphaned(relative)
                record_path('migrated', relative)
                record_ownership(relative, 'dhpk-managed')
                continue
            if not owned:
                if relative in adopt_paths:
                    expected = next(
                        item.get('destination_fingerprint')
                        for item in plan.get('collisions', [])
                        if item.get('path') == relative
                    )
                    expected_source = adopt_paths[relative]
                    if (safe_destination_fingerprint(destination) != expected
                            or hash_path(source, include_ignored=False) != expected_source):
                        print(
                            f'[install-codex-skills] ERROR: adoption preflight changed: {relative}; run a fresh plan',
                            file=sys.stderr,
                        )
                        rollback_pending()
                        sys.exit(2)
                    counts['backed_up'] += 1

                    def persist_adopted():
                        # Update the in-memory ownership record before the
                        # final receipt write. adopt_materialized keeps the
                        # original quarantined until this callback succeeds,
                        # so a receipt failure restores the old projection.
                        entries[kind][name] = make_entry(
                            source,
                            relative,
                            destination,
                            skill_metadata.get(name) if kind == 'skills' else None,
                        )
                        clear_orphaned(relative)
                        counts['adopted'] += 1
                        record_path('adopted', relative)
                        record_ownership(relative, 'dhpk-managed')
                        save_receipt_with_prune_rollback(
                            plugin_version,
                            fingerprint,
                            entries,
                            orphaned,
                            counts,
                            legacy_pending=legacy_pending,
                            state='partial',
                            transaction_final=False,
                        )

                    try:
                        adopt_materialized(
                            source,
                            destination,
                            relative,
                            expected_source,
                            expected,
                            persist_backup=lambda: save_receipt_with_prune_rollback(
                                plugin_version,
                                fingerprint,
                                entries,
                                orphaned,
                                counts,
                                legacy_pending=legacy_pending,
                                state='partial',
                                transaction_final=False,
                            ),
                            persist_adoption=persist_adopted,
                        )
                    except ReceiptCommitError as error:
                        print(f'[install-codex-skills] ERROR: adoption receipt commit completed but durability flush failed: {error}', file=sys.stderr)
                        rollback_pending()
                        sys.exit(2)
                    except AdoptionCommittedError as error:
                        print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
                        rollback_pending()
                        sys.exit(2)
                    except (OSError, ValueError) as error:
                        print(f'[install-codex-skills] ERROR: adoption rolled back: {error}', file=sys.stderr)
                        rollback_pending()
                        sys.exit(2)
                    continue
                collisions.append(relative)
                counts['skipped_collision'] += 1
                counts['preserved'] += 1
                record_path('collisions', relative)
                record_ownership(relative, 'unowned-collision')
                continue
            if old.get('orphaned'):
                collisions.append(relative)
                counts['skipped_collision'] += 1
                counts['preserved'] += 1
                record_path('collisions', relative)
                record_ownership(relative, 'orphaned')
                continue
            if old.get('mode') == MODE and exact_source_match(source, destination):
                entries[kind][name] = make_entry(source, relative, destination, skill_metadata.get(name) if kind == 'skills' else None)
                clear_orphaned(relative)
                record_ownership(relative, 'dhpk-managed')
                continue
            backup = backup_destination(relative, destination, 'updated-entry')
            if backup:
                counts['backed_up'] += 1
            else:
                raise OSError(f'cannot create rollback backup for managed destination: {relative}')
            register_pending_mutation(
                relative,
                destination,
                backup,
                hash_path(source, include_ignored=False),
            )
            install(source, destination)
            entries[kind][name] = make_entry(source, relative, destination, skill_metadata.get(name) if kind == 'skills' else None)
            clear_orphaned(relative)
            counts['updated'] += 1
            record_path('updated', relative)
            record_ownership(relative, 'dhpk-managed')
        else:
            register_pending_mutation(
                relative,
                destination,
                None,
                hash_path(source, include_ignored=False),
            )
            install(source, destination)
            entries[kind][name] = make_entry(source, relative, destination, skill_metadata.get(name) if kind == 'skills' else None)
            clear_orphaned(relative)
            counts['created'] += 1
            record_path('created', relative)
            record_ownership(relative, 'dhpk-managed')

if legacy_pending and MIGRATE and not collisions:
    legacy_pending = False
reconciliation_state = (
    'stale'
    if legacy_pending
    else ('partial' if collisions or orphaned or evidence_paths.get('deferred') else 'current')
)
try:
    save_receipt_with_prune_rollback(
        plugin_version,
        fingerprint,
        entries,
        orphaned,
        counts,
        legacy_pending=legacy_pending,
        state=reconciliation_state,
    )
except ReceiptCommitError as error:
    print(f'[install-codex-skills] ERROR: receipt commit completed but durability flush failed: {error}', file=sys.stderr)
    sys.exit(2)
except Exception as error:
    rollback_pending()
    print(f'[install-codex-skills] ERROR: reconciliation receipt update failed; retired entries restored where possible: {error}', file=sys.stderr)
    sys.exit(2)
counts['collided'] = counts.get('skipped_collision', 0)
counts['backed_up'] = counts.get('backed_up', 0)
print_summary(counts, collisions, sorted(orphaned))
print(f'[install-codex-skills] synced dhpk v{plugin_version} {SRC_REL}/ → project-local {DEST_REL}/ (mode={MODE})')
if UPDATE and collisions and not ADOPT_PATHS:
    print(
        '[install-codex-skills] ACTION REQUIRED: review collision evidence, then re-run with '
        '--update --adopt=<reported-relative-path>@<destination-fingerprint>@<source-fingerprint>',
        file=sys.stderr,
    )
    sys.exit(1)
PY
