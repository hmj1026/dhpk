#!/usr/bin/env bash
# Copy selected dhpk assets into a consumer project's .claude/dhpk directory.
# This is deliberately a small, deterministic installer: it never edits the
# consumer's settings and never overwrites differing files without --force.
# Default --install rules writes a project-delta stub beside TARGET rather
# than copying upstream policy; --vendor restores the legacy verbatim copy.
# TARGET/.dhpk-asset-receipt.json is the Asset Receipt: it records the source
# version and SHA-256 digest of every installed file so an upgrade can replace
# an unchanged earlier snapshot while user edits stay protected. It is
# independent of the multi-Host Projection Journal.

set -eu

SCRIPT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$SCRIPT_ROOT"
TARGET=""
INSTALL=""
DRY_RUN=0
PLAN=0
JSON=0
FORCE=0
VENDOR=0
RULES_STUB_NAME="dhpk-overrides.md"
STUB_SOURCE_DIR=""

usage() {
    cat <<'EOF'
Usage: install-assets.sh --install hooks|rules|scripts|all [--source DIR] [--target DIR] [--dry-run | --plan [--json]] [--force] [--vendor]

Copies selected source assets into TARGET (normally <project>/.claude/dhpk).
Default --install rules|all writes <parent-of-TARGET>/rules/dhpk-overrides.md
instead of copying upstream policy into TARGET/rules. --vendor restores that
verbatim copy and is discouraged.

TARGET/.dhpk-asset-receipt.json records the installed source version and
SHA-256 digests. Each destination is updatable (absent, or unchanged since the
receipt recorded it), unchanged (identical to the new source), user-modified
(receipt-owned but edited), or unmanaged-existing (no receipt entry and
different). The last two are conflicts: they leave every asset untouched
unless --force is supplied, which first saves them under
TARGET/.dhpk-asset-backups/<UTC timestamp>/. Identical files are adopted into
the receipt even when a conflict stops the run.

--dry-run and --plan print the complete plan without writing; --plan --json
prints it as JSON. Exit 3 means conflicts block the install.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --install) INSTALL="${2:-}"; shift 2 ;;
        --source) SOURCE="${2:-}"; shift 2 ;;
        --target) TARGET="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --plan) PLAN=1; DRY_RUN=1; shift ;;
        --json) JSON=1; shift ;;
        --force) FORCE=1; shift ;;
        --vendor) VENDOR=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
    esac
done

case "$INSTALL" in hooks|rules|scripts|all) ;; *) echo "--install is required" >&2; usage >&2; exit 64 ;; esac
[ -n "$TARGET" ] || { echo "--target is required" >&2; usage >&2; exit 64; }
if [ "$JSON" -eq 1 ] && [ "$PLAN" -ne 1 ]; then
    echo "--json is only valid with --plan" >&2; usage >&2; exit 64
fi
[ -d "$SOURCE" ] || { echo "Source directory does not exist: $SOURCE" >&2; exit 66; }
if [ "$VENDOR" -eq 1 ]; then
    case "$INSTALL" in
        rules|all) ;;
        *) echo "--vendor is only valid with --install rules or --install all" >&2; usage >&2; exit 64 ;;
    esac
fi

rules_stub_dir() {
    printf '%s/rules' "$(dirname -- "$TARGET")"
}

rules_stub_path() {
    printf '%s/%s' "$(rules_stub_dir)" "$RULES_STUB_NAME"
}

installs_rules_stub() {
    [ "$VENDOR" -eq 0 ] && { [ "$INSTALL" = "rules" ] || [ "$INSTALL" = "all" ]; }
}

write_rules_stub_template() {
    cat > "$1/$RULES_STUB_NAME" <<'EOF'
# dhpk execution-policy overrides

Canonical source: the plugin runtime `rules/` directory
(`${CLAUDE_PLUGIN_ROOT}/rules/`). Do not vendor a local copy of those files.

This file is the consumer delta. Keep only project-specific extensions.

## Project deltas

### Extra reviewer trigger paths

### Hot tables

### Hook profile
EOF
}

cleanup_rules_stub_source() {
    if [ -n "$STUB_SOURCE_DIR" ] && [ -d "$STUB_SOURCE_DIR" ]; then
        rm -rf "$STUB_SOURCE_DIR"
    fi
}

prepare_rules_stub_source() {
    installs_rules_stub || return 0
    STUB_SOURCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dhpk-rules-stub.XXXXXX")"
    STUB_SOURCE_DIR="$(cd -P -- "$STUB_SOURCE_DIR" && pwd -P)"
    write_rules_stub_template "$STUB_SOURCE_DIR"
}

trap cleanup_rules_stub_source EXIT
prepare_rules_stub_source

report_legacy_vendored_rules() {
    installs_rules_stub || return 0
    if [ -e "$TARGET/rules" ] || [ -L "$TARGET/rules" ]; then
        echo "LEGACY PRESERVED $TARGET/rules (vendored upstream rules from an older install; canonical policy lives in the plugin runtime. Use $(rules_stub_path) for project deltas. This installer does not delete the legacy tree.)" >&2
    fi
}

report_vendor_rules_copy() {
    [ "$VENDOR" -eq 1 ] || return 0
    echo "VENDOR COPY $TARGET/rules (discouraged: copies upstream policy into the consumer tree and will drift. Prefer --install rules without --vendor, which writes a project-delta stub at $(rules_stub_path).)" >&2
}

HAVE_PYTHON=0
if command -v python3 >/dev/null 2>&1; then
    HAVE_PYTHON=1
fi
HAS_CONFLICT=0
HAS_UNSAFE_SYMLINK=0
HAS_UNSAFE_DESTINATION=0
HAS_MISSING_PILOT_RESOURCE=0
HAS_UNSAFE_PILOT_SOURCE=0
HAS_LEGACY_RUNNER_CONFLICT=0
TREE_ARGS=()

has_symlink_component() {
    local candidate="$1"
    while [ "$candidate" != "/" ] && [ "$candidate" != "." ]; do
        [ -L "$candidate" ] && return 0
        candidate="$(dirname "$candidate")"
    done
    return 1
}

# Each tree is passed to the receipt installer as four arguments: source
# directory, destination anchor (target or target-parent), destination path
# relative to that anchor, and comma-separated top-level skips ("-" for none).
collect_tree() {
    local source_dir="$1" target_dir="$2" anchor="" relative="" skips="-"
    case "$target_dir" in
        "$TARGET"/*) anchor="target"; relative="${target_dir#"$TARGET"/}" ;;
        "$(rules_stub_dir)") anchor="target-parent"; relative="rules" ;;
    esac
    [ -n "$anchor" ] || { echo "UNSAFE DESTINATION $target_dir is outside the selected target" >&2; exit 4; }
    if [ "$target_dir" = "$TARGET/scripts" ]; then
        skips="precommit-runner.js,verify-runner.js,harness-audit.js"
    fi
    TREE_ARGS+=("$source_dir" "$anchor" "$relative" "$skips")
}

walk_tree() {
    local mode="$1" source_dir="$2" target_dir="$3" source_file rel target_file
    [ -d "$source_dir" ] || { echo "Missing source asset directory: $source_dir" >&2; exit 66; }
    if [ "$mode" = "collect" ]; then
        collect_tree "$source_dir" "$target_dir"
        return
    fi
    while IFS= read -r -d '' source_file; do
        rel="${source_file#"$source_dir"/}"
        target_file="$target_dir/$rel"
        if [ "$target_dir" = "$TARGET/scripts" ]; then
            case "$rel" in
                precommit-runner.js|verify-runner.js|harness-audit.js)
                    if [ "$mode" = "report" ]; then
                        echo "SKIP $target_file (legacy runner path removed; use the Skill-local runner tree)"
                    fi
                    continue
                    ;;
            esac
        fi
        case "$mode" in
            check)
                if has_symlink_component "$target_file"; then
                    echo "UNSAFE SYMLINK $target_file (destination path escapes the selected target)" >&2
                    HAS_UNSAFE_SYMLINK=1
                elif [ -e "$target_file" ] && [ ! -f "$target_file" ]; then
                    echo "UNSAFE DESTINATION $target_file (existing destination is not a regular file)" >&2
                    HAS_UNSAFE_DESTINATION=1
                elif [ -f "$target_file" ] && ! cmp -s "$source_file" "$target_file"; then
                    HAS_CONFLICT=1
                    if [ "$HAVE_PYTHON" -ne 1 ]; then
                        echo "CONFLICT $target_file (source: $source_file)" >&2
                    fi
                fi
                ;;
            report)
                if [ -f "$target_file" ] && cmp -s "$source_file" "$target_file"; then
                    echo "SKIP $target_file (identical)"
                elif [ -f "$target_file" ]; then
                    echo "DRY-RUN OVERWRITE $target_file (source: $source_file)"
                else
                    echo "DRY-RUN COPY $target_file (source: $source_file)"
                fi
                ;;
        esac
    done < <(find "$source_dir" -type f -print0)
}

run_receipt_installer() {
    local mode="$1"
    python3 -I -S - "$mode" "$JSON" "$FORCE" "$INSTALL" "$SOURCE" "$TARGET" "${TREE_ARGS[@]}" <<'PY'
import errno
import hashlib
import inspect
import json
import os
import stat
import sys
import time

RECEIPT_NAME = '.dhpk-asset-receipt.json'
RECEIPT_SCHEMA = 'dhpk.asset-receipt.v1'
PLAN_SCHEMA = 'dhpk.asset-plan.v1'
BACKUP_DIR = '.dhpk-asset-backups'
ANCHORS = ('target', 'target-parent')
CONFLICT_STATES = ('user-modified', 'unmanaged-existing')
MAX_METADATA_BYTES = 4 * 1024 * 1024
REASON_CODES = {
    2: 'PYTHON_CAPABILITY_UNAVAILABLE',
    3: 'CONFLICT',
    4: 'UNSAFE_PATH',
    65: 'INVALID_ASSET_RECEIPT',
    66: 'MISSING_SOURCE',
}
JSON_OUTPUT = len(sys.argv) > 2 and sys.argv[2] == '1'


class InstallerFailure(Exception):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def failure(message, code):
    raise InstallerFailure(message, code)


def validate_component(component, label):
    if not component or component in ('.', '..') or '/' in component or '\\' in component or '\x00' in component:
        failure('UNSAFE DESTINATION {} contains an unsafe path component'.format(label), 4)


def valid_relative(relative):
    if not isinstance(relative, str) or not relative:
        return False
    for component in relative.split('/'):
        if not component or component in ('.', '..') or '\\' in component or '\x00' in component:
            return False
    return True


def valid_digest(digest):
    return isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest)


def require_capabilities():
    missing = []
    if not hasattr(os, 'O_DIRECTORY'):
        missing.append('O_DIRECTORY')
    if not hasattr(os, 'O_NOFOLLOW'):
        missing.append('O_NOFOLLOW')
    supports_dir_fd = getattr(os, 'supports_dir_fd', set())
    for name, function in (
        ('open(dir_fd)', os.open),
        ('mkdir(dir_fd)', os.mkdir),
        ('stat(dir_fd)', os.stat),
        ('unlink(dir_fd)', os.unlink),
    ):
        if function not in supports_dir_fd:
            missing.append(name)
    if os.stat not in getattr(os, 'supports_follow_symlinks', set()):
        missing.append('stat(follow_symlinks=False)')
    replace_parameters = None
    try:
        replace_parameters = inspect.signature(os.replace).parameters
    except (TypeError, ValueError):
        pass
    replace_has_dir_fd = bool(replace_parameters and {
        'src_dir_fd', 'dst_dir_fd',
    }.issubset(replace_parameters))
    if not replace_has_dir_fd and os.replace not in supports_dir_fd:
        # os.replace is absent from supports_dir_fd on some supported Python
        # builds even though its signature exposes both descriptor arguments.
        missing.append('replace(src_dir_fd,dst_dir_fd)')
    if missing:
        failure('Python3 physical copy capabilities unavailable: {}'.format(', '.join(missing)), 2)


def physical_root(path, create, label, optional=False):
    absolute = os.path.abspath(path)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        current = os.open('/', flags)
    except OSError as error:
        failure('UNSAFE SOURCE {} cannot open filesystem root: {}'.format(label, error), 4)
    try:
        components = [component for component in absolute.split('/') if component]
        for component in components:
            validate_component(component, '{} component'.format(label))
            try:
                child = os.open(component, flags, dir_fd=current)
            except FileNotFoundError:
                if optional:
                    os.close(current)
                    return None
                if not create:
                    failure('Missing source asset directory: {}'.format(path), 66)
                try:
                    os.mkdir(component, 0o755, dir_fd=current)
                except FileExistsError:
                    pass
                try:
                    child = os.open(component, flags, dir_fd=current)
                except OSError as retry_error:
                    if retry_error.errno == errno.ELOOP:
                        failure('UNSAFE SYMLINK {} contains a symlinked directory component'.format(path), 4)
                    failure('UNSAFE DESTINATION {} cannot open directory: {}'.format(path, retry_error), 4)
            except OSError as error:
                if error.errno == errno.ELOOP:
                    failure('UNSAFE SYMLINK {} contains a symlinked directory component'.format(path), 4)
                if error.errno == errno.ENOTDIR:
                    failure('UNSAFE DESTINATION {} contains a non-directory component'.format(path), 4)
                if error.errno == errno.ENOENT:
                    failure('Missing source asset directory: {}'.format(path), 66)
                failure('UNSAFE DESTINATION {} cannot open directory: {}'.format(path, error), 4)
            os.close(current)
            current = child
        descriptor_stat = os.fstat(current)
        if not stat.S_ISDIR(descriptor_stat.st_mode):
            failure('UNSAFE DESTINATION {} is not a directory'.format(path), 4)
        return current
    except InstallerFailure:
        os.close(current)
        raise
    except OSError as error:
        os.close(current)
        failure('UNSAFE DESTINATION {} cannot be opened: {}'.format(path, error), 4)


def directory_open_failure(error, label):
    if error.errno == errno.ELOOP:
        failure('UNSAFE SYMLINK {} contains a symlinked directory component'.format(label), 4)
    if error.errno == errno.ENOTDIR:
        failure('UNSAFE DESTINATION {} contains a non-directory component'.format(label), 4)
    failure('UNSAFE DESTINATION {} cannot open directory: {}'.format(label, error), 4)


def open_child_directory(parent_fd, component, create, label):
    validate_component(component, label)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        return os.open(component, flags, dir_fd=parent_fd)
    except FileNotFoundError:
        if not create:
            failure('Missing source asset directory: {}'.format(label), 66)
        try:
            os.mkdir(component, 0o755, dir_fd=parent_fd)
        except FileExistsError:
            pass
        try:
            return os.open(component, flags, dir_fd=parent_fd)
        except OSError as error:
            directory_open_failure(error, label)
    except OSError as error:
        directory_open_failure(error, label)


def open_relative_directory(root_fd, components, create, label):
    current = os.dup(root_fd)
    try:
        for component in components:
            child = open_child_directory(current, component, create, '{}/{}'.format(label, component))
            os.close(current)
            current = child
        return current
    except InstallerFailure:
        os.close(current)
        raise


def open_relative_optional(root_fd, components, label):
    """Open an existing directory below root_fd, or return None when any component is absent."""
    if root_fd is None:
        return None
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    current = os.dup(root_fd)
    try:
        for component in components:
            validate_component(component, label)
            try:
                child = os.open(component, flags, dir_fd=current)
            except FileNotFoundError:
                return None
            except OSError as error:
                directory_open_failure(error, label)
            os.close(current)
            current = child
        result, current = current, None
        return result
    finally:
        if current is not None:
            os.close(current)


def leaf_stat(parent_fd, leaf, label):
    validate_component(leaf, label)
    try:
        return os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    except OSError as error:
        if error.errno == errno.ELOOP:
            failure('UNSAFE SYMLINK {} is a symlink'.format(label), 4)
        failure('UNSAFE DESTINATION {} cannot be inspected: {}'.format(label, error), 4)


def open_regular(parent_fd, leaf, label, role):
    """Open a regular file without following symlinks; return (fd, stat) or (None, None) when absent."""
    existing = leaf_stat(parent_fd, leaf, label)
    if existing is None:
        return None, None
    if stat.S_ISLNK(existing.st_mode):
        failure('UNSAFE SYMLINK {} is a symlink'.format(label), 4)
    if not stat.S_ISREG(existing.st_mode):
        failure('UNSAFE {} {} is not a regular file'.format(role, label), 4)
    try:
        descriptor = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
    except OSError as error:
        if error.errno == errno.ELOOP:
            failure('UNSAFE SYMLINK {} is a symlink'.format(label), 4)
        failure('UNSAFE {} {} cannot be opened: {}'.format(role, label, error), 4)
    opened = os.fstat(descriptor)
    if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (existing.st_dev, existing.st_ino):
        os.close(descriptor)
        failure('UNSAFE {} {} changed while it was opened'.format(role, label), 4)
    return descriptor, opened


def digest_fd(descriptor):
    os.lseek(descriptor, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            return digest.hexdigest()
        digest.update(chunk)


def read_bounded(descriptor, label, code):
    chunks = []
    total = 0
    while True:
        chunk = os.read(descriptor, 64 * 1024)
        if not chunk:
            return b''.join(chunks)
        total += len(chunk)
        if total > MAX_METADATA_BYTES:
            failure('{} exceeds {} bytes'.format(label, MAX_METADATA_BYTES), code)
        chunks.append(chunk)


def create_stage(parent_fd, mode):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    for _ in range(100):
        name = '.dhpk-install-{}-{}'.format(os.getpid(), os.urandom(8).hex())
        try:
            descriptor = os.open(name, flags, mode=0o600, dir_fd=parent_fd)
            return name, descriptor
        except FileExistsError:
            continue
    failure('UNSAFE DESTINATION could not allocate a private staging file', 4)


def remove_stage(parent_fd, name):
    if not name:
        return
    try:
        os.unlink(name, dir_fd=parent_fd)
    except OSError:
        pass


def stage_copy(read_fd, parent_fd, mode):
    """Copy read_fd into a new private stage; return (stage name, SHA-256 of the copied bytes, staged stat)."""
    os.lseek(read_fd, 0, os.SEEK_SET)
    stage_name, stage_fd = create_stage(parent_fd, mode)
    digest = hashlib.sha256()
    try:
        while True:
            chunk = os.read(read_fd, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                count = os.write(stage_fd, view)
                view = view[count:]
        os.fchmod(stage_fd, mode)
        os.fsync(stage_fd)
        staged = os.fstat(stage_fd)
    except BaseException:
        os.close(stage_fd)
        remove_stage(parent_fd, stage_name)
        raise
    os.close(stage_fd)
    return stage_name, digest.hexdigest(), staged


def publish_stage(parent_fd, stage_name, leaf, staged, existing, label):
    current = leaf_stat(parent_fd, leaf, label)
    if existing is None:
        if current is not None:
            if stat.S_ISLNK(current.st_mode):
                failure('UNSAFE SYMLINK {} appeared during staging'.format(label), 4)
            failure('UNSAFE DESTINATION {} appeared during staging'.format(label), 4)
    else:
        if current is None or (current.st_dev, current.st_ino) != (existing.st_dev, existing.st_ino):
            failure('UNSAFE DESTINATION {} changed during staging'.format(label), 4)
        if stat.S_ISLNK(current.st_mode) or not stat.S_ISREG(current.st_mode):
            failure('UNSAFE DESTINATION {} changed to a non-regular entry'.format(label), 4)
    try:
        os.replace(stage_name, leaf, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
    except OSError as error:
        failure('UNSAFE DESTINATION {} could not be published: {}'.format(label, error), 4)
    published = leaf_stat(parent_fd, leaf, label)
    if published is None or stat.S_ISLNK(published.st_mode) or not stat.S_ISREG(published.st_mode):
        failure('UNSAFE DESTINATION {} is not a regular published file'.format(label), 4)
    if (published.st_dev, published.st_ino) != (staged.st_dev, staged.st_ino):
        failure('UNSAFE DESTINATION {} published inode changed'.format(label), 4)
    os.fsync(parent_fd)


def read_source_version(source_root_fd):
    for components in (['package.json'], ['.claude-plugin', 'plugin.json']):
        try:
            parent = open_relative_optional(source_root_fd, components[:-1], 'source version')
            if parent is None:
                continue
            try:
                descriptor, _ = open_regular(parent, components[-1], 'source version', 'SOURCE')
            finally:
                os.close(parent)
            if descriptor is None:
                continue
            try:
                data = read_bounded(descriptor, 'source version', 4)
            finally:
                os.close(descriptor)
            version = json.loads(data.decode('utf-8')).get('version')
        except (InstallerFailure, ValueError, AttributeError):
            continue
        if isinstance(version, str) and version:
            return version
    return 'unknown'


def load_receipt(target_fd, receipt_path):
    if target_fd is None:
        return None
    descriptor, _ = open_regular(target_fd, RECEIPT_NAME, receipt_path, 'DESTINATION')
    if descriptor is None:
        return None
    try:
        data = read_bounded(descriptor, 'INVALID ASSET RECEIPT {}'.format(receipt_path), 65)
    finally:
        os.close(descriptor)

    def invalid(reason):
        failure('INVALID ASSET RECEIPT {} ({}). Move it aside and re-run to re-adopt byte-identical files.'.format(
            receipt_path, reason), 65)

    try:
        document = json.loads(data.decode('utf-8'))
    except ValueError:
        invalid('not valid JSON')
    if not isinstance(document, dict) or document.get('schema') != RECEIPT_SCHEMA:
        invalid('unsupported schema')
    entries = document.get('entries')
    if not isinstance(entries, list):
        invalid('entries must be a list')
    recorded = {}
    for entry in entries:
        if not isinstance(entry, dict):
            invalid('malformed entry')
        key = (entry.get('anchor'), entry.get('path'))
        version = entry.get('source_version')
        if key[0] not in ANCHORS or not valid_relative(key[1]) or not valid_digest(entry.get('sha256')):
            invalid('malformed entry')
        if version is not None and not isinstance(version, str):
            invalid('malformed entry')
        if key in recorded:
            invalid('duplicate entry {}:{}'.format(key[0], key[1]))
        recorded[key] = {'sha256': entry['sha256'], 'source_version': version}
    version = document.get('source_version')
    return {
        'source_version': version if isinstance(version, str) else None,
        'entries': recorded,
        'raw': data,
    }


def render_receipt(source_version, entries):
    document = {
        'schema': RECEIPT_SCHEMA,
        'source_version': source_version,
        'entries': [
            {'anchor': anchor, 'path': relative, 'sha256': record['sha256'], 'source_version': record['source_version']}
            for (anchor, relative), record in sorted(entries.items())
        ],
    }
    return (json.dumps(document, indent=2, sort_keys=True) + '\n').encode('utf-8')


def write_receipt(target_fd, data, receipt_path):
    stage_name, stage_fd = create_stage(target_fd, 0o644)
    try:
        view = memoryview(data)
        while view:
            count = os.write(stage_fd, view)
            view = view[count:]
        os.fchmod(stage_fd, 0o644)
        os.fsync(stage_fd)
        os.close(stage_fd)
        stage_fd = None
        current = leaf_stat(target_fd, RECEIPT_NAME, receipt_path)
        if current is not None and (stat.S_ISLNK(current.st_mode) or not stat.S_ISREG(current.st_mode)):
            failure('UNSAFE DESTINATION {} is not a regular file'.format(receipt_path), 4)
        try:
            os.replace(stage_name, RECEIPT_NAME, src_dir_fd=target_fd, dst_dir_fd=target_fd)
        except OSError as error:
            failure('UNSAFE DESTINATION {} could not be published: {}'.format(receipt_path, error), 4)
        stage_name = None
        os.fsync(target_fd)
    finally:
        if stage_fd is not None:
            os.close(stage_fd)
        remove_stage(target_fd, stage_name)


def enumerate_tree(source_fd, relative, tree, skips, items):
    try:
        names = sorted(os.listdir(source_fd))
    except OSError as error:
        failure('UNSAFE SOURCE cannot enumerate {}: {}'.format(relative or '.', error), 4)
    for name in names:
        validate_component(name, name)
        child_relative = '{}/{}'.format(relative, name) if relative else name
        try:
            child_stat = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        except FileNotFoundError:
            failure('UNSAFE SOURCE {} disappeared during enumeration'.format(child_relative), 4)
        except OSError as error:
            failure('UNSAFE SOURCE {} cannot be inspected: {}'.format(child_relative, error), 4)
        if stat.S_ISDIR(child_stat.st_mode):
            child_fd = open_child_directory(source_fd, name, False, child_relative)
            try:
                enumerate_tree(child_fd, child_relative, tree, skips, items)
            finally:
                os.close(child_fd)
        elif stat.S_ISREG(child_stat.st_mode):
            if child_relative in skips:
                tree['skipped'].append(child_relative)
                continue
            descriptor, opened = open_regular(source_fd, name, child_relative, 'SOURCE')
            if descriptor is None:
                failure('UNSAFE SOURCE {} disappeared during enumeration'.format(child_relative), 4)
            try:
                source_digest = digest_fd(descriptor)
            finally:
                os.close(descriptor)
            items.append({
                'tree': tree,
                'source_relative': child_relative,
                'anchor': tree['anchor'],
                'path': '{}/{}'.format(tree['prefix'], child_relative),
                'source_sha256': source_digest,
                'mode': stat.S_IMODE(opened.st_mode),
            })


def current_digest(root_fd, relative, label):
    components = relative.split('/')
    parent = open_relative_optional(root_fd, components[:-1], label)
    if parent is None:
        return None
    try:
        descriptor, _ = open_regular(parent, components[-1], label, 'DESTINATION')
    finally:
        os.close(parent)
    if descriptor is None:
        return None
    try:
        return digest_fd(descriptor)
    finally:
        os.close(descriptor)


def classify(current, source, recorded):
    if current is None:
        return 'updatable', 'absent', 'copy'
    if current == source:
        return 'unchanged', 'identical', 'skip'
    if recorded is not None:
        if current == recorded:
            return 'updatable', 'receipt-match', 'update'
        return 'user-modified', 'receipt-digest-mismatch', 'preserve'
    return 'unmanaged-existing', 'no-receipt-entry', 'preserve'


def backup_asset(item, destination_fd, backup_fd):
    components = item['path'].split('/')
    label = item['target']
    parent = open_relative_optional(destination_fd, components[:-1], label)
    if parent is None:
        failure('CONFLICT {} (disappeared before it was backed up)'.format(label), 3)
    try:
        descriptor, opened = open_regular(parent, components[-1], label, 'DESTINATION')
    finally:
        os.close(parent)
    if descriptor is None:
        failure('CONFLICT {} (disappeared before it was backed up)'.format(label), 3)
    backup_parent = None
    stage_name = None
    try:
        backup_parent = open_relative_directory(backup_fd, [item['anchor']] + components[:-1], True, 'backup')
        stage_name, digest, staged = stage_copy(descriptor, backup_parent, stat.S_IMODE(opened.st_mode))
        if digest != item['current_sha256']:
            failure('CONFLICT {} (changed while it was backed up)'.format(label), 3)
        publish_stage(backup_parent, stage_name, components[-1], staged, None, 'backup of {}'.format(label))
        stage_name = None
    finally:
        os.close(descriptor)
        if backup_parent is not None:
            remove_stage(backup_parent, stage_name)
            os.close(backup_parent)


def publish_asset(item, destination_fd):
    tree = item['tree']
    label = item['target']
    source_components = item['source_relative'].split('/')
    components = item['path'].split('/')
    leaf = components[-1]
    source_parent = open_relative_directory(tree['fd'], source_components[:-1], False, 'source {}'.format(label))
    target_parent = None
    source_fd = None
    stage_name = None
    try:
        source_fd, _ = open_regular(source_parent, source_components[-1], item['source'], 'SOURCE')
        if source_fd is None:
            failure('UNSAFE SOURCE {} disappeared before it was copied'.format(item['source']), 4)
        target_parent = open_relative_directory(destination_fd, components[:-1], True, 'destination parent {}'.format(label))
        existing_fd, existing = open_regular(target_parent, leaf, label, 'DESTINATION')
        current = None
        if existing_fd is not None:
            try:
                current = digest_fd(existing_fd)
            finally:
                os.close(existing_fd)
        if current != item['current_sha256']:
            failure('CONFLICT {} (changed since it was classified)'.format(label), 3)
        stage_name, digest, staged = stage_copy(source_fd, target_parent, item['mode'])
        if digest != item['source_sha256']:
            failure('UNSAFE SOURCE {} changed while staging'.format(item['source']), 4)
        publish_stage(target_parent, stage_name, leaf, staged, existing, label)
        stage_name = None
    finally:
        if target_parent is not None:
            remove_stage(target_parent, stage_name)
            os.close(target_parent)
        if source_fd is not None:
            os.close(source_fd)
        os.close(source_parent)


def create_backup_root(target_fd):
    container = open_child_directory(target_fd, BACKUP_DIR, True, BACKUP_DIR)
    try:
        stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        for attempt in range(100):
            name = stamp if attempt == 0 else '{}-{}'.format(stamp, attempt)
            try:
                os.mkdir(name, 0o700, dir_fd=container)
            except FileExistsError:
                continue
            return name, open_child_directory(container, name, False, '{}/{}'.format(BACKUP_DIR, name))
        failure('UNSAFE DESTINATION could not allocate a backup directory under {}'.format(BACKUP_DIR), 4)
    finally:
        os.close(container)


def emit(line, error=False):
    if not JSON_OUTPUT:
        print(line, file=sys.stderr if error else sys.stdout)


def describe(item, force, prefix):
    state = item['state']
    if state == 'unchanged':
        return 'SKIP {} (identical)'.format(item['target']), False
    if item['reason'] == 'absent':
        return '{}COPY {} (source: {})'.format(prefix, item['target'], item['source']), False
    if state == 'updatable':
        return '{}UPDATE {} (unchanged since the Asset Receipt recorded it; source: {})'.format(
            prefix, item['target'], item['source']), False
    explanation = ('edited since the Asset Receipt recorded it' if state == 'user-modified'
                   else 'not recorded in the Asset Receipt and differs from the source')
    if force:
        return '{}OVERWRITE {} ({}: {}; backed up first; source: {})'.format(
            prefix, item['target'], state, explanation, item['source']), False
    return 'CONFLICT {} ({}: {}; source: {})'.format(item['target'], state, explanation, item['source']), True


def plan_report(context, items, blocked):
    summary = {'updatable': 0, 'unchanged': 0, 'user-modified': 0, 'unmanaged-existing': 0}
    entries = []
    for item in items:
        summary[item['state']] += 1
        action = item['action']
        if item['state'] in CONFLICT_STATES and context['force']:
            action = 'backup-and-overwrite'
        entries.append({
            'anchor': item['anchor'],
            'path': item['path'],
            'target': item['target'],
            'source': item['source'],
            'state': item['state'],
            'reason': item['reason'],
            'action': action,
            'source_sha256': item['source_sha256'],
            'current_sha256': item['current_sha256'],
            'receipt_sha256': item['receipt_sha256'],
        })
    receipt = context['receipt']
    return {
        'schema': PLAN_SCHEMA,
        'install': context['install'],
        'source': context['source'],
        'target': context['target'],
        'source_version': context['source_version'],
        'force': context['force'],
        'verdict': 'CONFLICT' if blocked else 'READY',
        'receipt': {
            'path': context['receipt_path'],
            'state': 'present' if receipt is not None else 'absent',
            'source_version': receipt['source_version'] if receipt is not None else None,
        },
        'backup': {
            'required': bool(context['force'] and summary['user-modified'] + summary['unmanaged-existing']),
            'root': os.path.join(context['target'], BACKUP_DIR),
        },
        'summary': summary,
        'entries': entries,
        'skipped': context['skipped'],
    }


def blocked_report(error):
    return {
        'schema': PLAN_SCHEMA,
        'verdict': 'BLOCKED',
        'reasonCode': REASON_CODES.get(error.code, 'INSTALLER_FAILURE'),
        'exitCode': error.code,
        'message': str(error),
    }


def run(mode, force, install, source, target, tree_arguments, opened):
    require_capabilities()
    target_path = os.path.abspath(target)
    anchor_paths = {'target': target_path, 'target-parent': os.path.dirname(target_path)}
    receipt_path = os.path.join(target_path, RECEIPT_NAME)

    source_root = physical_root(source, False, 'source')
    opened.append(source_root)
    source_version = read_source_version(source_root)

    trees = []
    for index in range(0, len(tree_arguments), 4):
        source_dir, anchor, prefix, skips = tree_arguments[index:index + 4]
        if anchor not in ANCHORS or not valid_relative(prefix):
            failure('UNSAFE DESTINATION invalid tree arguments', 4)
        tree_fd = physical_root(source_dir, False, 'source')
        opened.append(tree_fd)
        trees.append({
            'source_dir': os.path.abspath(source_dir),
            'anchor': anchor,
            'prefix': prefix,
            'skips': set() if skips == '-' else set(skips.split(',')),
            'fd': tree_fd,
            'skipped': [],
        })

    existing_roots = {}
    for anchor, path in anchor_paths.items():
        existing_roots[anchor] = physical_root(path, False, 'destination', optional=True)
        if existing_roots[anchor] is not None:
            opened.append(existing_roots[anchor])
    receipt = load_receipt(existing_roots['target'], receipt_path)
    recorded = receipt['entries'] if receipt is not None else {}

    items = []
    seen = set()
    for tree in trees:
        tree_items = []
        enumerate_tree(tree['fd'], '', tree, tree['skips'], tree_items)
        for item in tree_items:
            key = (item['anchor'], item['path'])
            if key in seen:
                continue
            seen.add(key)
            item['target'] = os.path.join(anchor_paths[item['anchor']], item['path'])
            item['source'] = os.path.join(tree['source_dir'], item['source_relative'])
            item['current_sha256'] = current_digest(existing_roots[item['anchor']], item['path'], item['target'])
            record = recorded.get(key)
            item['receipt_sha256'] = record['sha256'] if record is not None else None
            item['state'], item['reason'], item['action'] = classify(
                item['current_sha256'], item['source_sha256'], item['receipt_sha256'])
            items.append(item)

    skipped = [os.path.join(anchor_paths[tree['anchor']], tree['prefix'], name)
               for tree in trees for name in tree['skipped']]
    conflicts = [item for item in items if item['state'] in CONFLICT_STATES]
    blocked = bool(conflicts) and not force
    context = {
        'install': install,
        'source': os.path.abspath(source),
        'target': target_path,
        'source_version': source_version,
        'force': force,
        'receipt': receipt,
        'receipt_path': receipt_path,
        'skipped': skipped,
    }

    if mode == 'plan':
        if JSON_OUTPUT:
            print(json.dumps(plan_report(context, items, blocked), indent=2, sort_keys=True))
        for path in skipped:
            emit('SKIP {} (legacy runner path removed; use the Skill-local runner tree)'.format(path))
        for item in items:
            line, error = describe(item, force, 'DRY-RUN ')
            emit(line, error)
        if blocked:
            emit('Installation aborted: resolve conflicts or re-run with --force.', True)
            raise SystemExit(3)
        return

    if blocked:
        for item in conflicts:
            emit(describe(item, force, '')[0], True)
        adopted = dict(recorded)
        for item in items:
            if item['state'] == 'unchanged':
                adopted[(item['anchor'], item['path'])] = {
                    'sha256': item['source_sha256'], 'source_version': source_version}
        if adopted != recorded:
            target_fd = physical_root(target_path, True, 'destination')
            opened.append(target_fd)
            write_receipt(target_fd, render_receipt(
                receipt['source_version'] if receipt is not None else None, adopted), receipt_path)
            emit('ADOPTED {} byte-identical file(s) into the Asset Receipt {}'.format(
                sum(1 for key in adopted if adopted[key] != recorded.get(key)), receipt_path))
        emit('Installation aborted: resolve conflicts or re-run with --force.', True)
        raise SystemExit(3)

    roots = {}
    for anchor in ANCHORS:
        roots[anchor] = physical_root(anchor_paths[anchor], True, 'destination')
        opened.append(roots[anchor])
    if conflicts:
        backup_name, backup_fd = create_backup_root(roots['target'])
        opened.append(backup_fd)
        for item in conflicts:
            backup_asset(item, roots[item['anchor']], backup_fd)
        emit('BACKUP {} ({} differing file(s) saved before --force overwrite)'.format(
            os.path.join(target_path, BACKUP_DIR, backup_name), len(conflicts)))
    for path in skipped:
        emit('SKIP {} (legacy runner path removed; use the Skill-local runner tree)'.format(path))
    updated = dict(recorded)
    for item in items:
        emit(describe(item, force, '')[0])
        if item['state'] != 'unchanged':
            publish_asset(item, roots[item['anchor']])
        updated[(item['anchor'], item['path'])] = {'sha256': item['source_sha256'], 'source_version': source_version}
    data = render_receipt(source_version, updated)
    if receipt is None or receipt['raw'] != data:
        write_receipt(roots['target'], data, receipt_path)
    emit('RECEIPT {} ({} entries; source version {})'.format(receipt_path, len(updated), source_version))


def main():
    if len(sys.argv) < 7 or (len(sys.argv) - 7) % 4 != 0 or sys.argv[1] not in ('plan', 'apply'):
        failure('UNSAFE DESTINATION invalid installer arguments', 4)
    opened = []
    try:
        run(sys.argv[1], sys.argv[3] == '1', sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7:], opened)
    finally:
        for descriptor in opened:
            os.close(descriptor)


if __name__ == '__main__':
    try:
        main()
    except InstallerFailure as error:
        if JSON_OUTPUT:
            print(json.dumps(blocked_report(error), indent=2, sort_keys=True))
        print(str(error), file=sys.stderr)
        raise SystemExit(error.code)
    except SystemExit:
        raise
    except Exception as error:
        failure_error = InstallerFailure('UNSAFE DESTINATION installer copy failed: {}'.format(error), 4)
        if JSON_OUTPUT:
            print(json.dumps(blocked_report(failure_error), indent=2, sort_keys=True))
        print(str(failure_error), file=sys.stderr)
        raise SystemExit(4)
PY
}

check_pilot_resources() {
    local skill runner source_file
    for skill in precommit repo-verify; do
        case "$skill" in
            precommit) runner="precommit-runner.js" ;;
            repo-verify) runner="verify-runner.js" ;;
        esac
        source_file="$SOURCE/skills/$skill/scripts/$runner"
        if [ ! -f "$source_file" ]; then
            echo "Missing required Skill resource: $source_file" >&2
            HAS_MISSING_PILOT_RESOURCE=1
        elif has_symlink_component "$source_file"; then
            echo "UNSAFE SOURCE $source_file (Skill resources must use a physical non-symlink path)" >&2
            HAS_UNSAFE_PILOT_SOURCE=1
        fi
        source_file="$SOURCE/skills/$skill/scripts/lib/runner-utils.js"
        if [ ! -f "$source_file" ]; then
            echo "Missing required pilot Skill resource: $source_file" >&2
            HAS_MISSING_PILOT_RESOURCE=1
        elif has_symlink_component "$source_file"; then
            echo "UNSAFE SOURCE $source_file (pilot resources must use a physical non-symlink path)" >&2
            HAS_UNSAFE_PILOT_SOURCE=1
        fi
    done
}

check_legacy_runner_conflicts() {
    local legacy_path
    for legacy_path in \
        "$TARGET/scripts/precommit-runner.js" \
        "$TARGET/scripts/verify-runner.js" \
        "$TARGET/scripts/harness-audit.js"; do
        if [ -e "$legacy_path" ] || [ -L "$legacy_path" ]; then
            echo "LEGACY CONFLICT $legacy_path (unowned legacy runner preserved). Manual reconciliation required: review and remove or relocate this file, then re-run --install $INSTALL; --force cannot overwrite this legacy path." >&2
            HAS_LEGACY_RUNNER_CONFLICT=1
        fi
    done
}

# Resume helpers moved into the opsx-apply-resume Skill. Older installs left
# copies here; they are unowned, so report them for manual removal instead of
# deleting or blocking on them.
report_legacy_resume_helpers() {
    local helper legacy_path
    for helper in detect-phase.sh extract-compact.sh post-obs.sh set-handoff-state.sh; do
        legacy_path="$TARGET/scripts/opsx-apply-resume/$helper"
        if [ -e "$legacy_path" ] || [ -L "$legacy_path" ]; then
            echo "LEGACY PRESERVED $legacy_path (unowned resume helper from an older install; the installed opsx-apply-resume Skill now owns its helpers). Manual action: delete it once nothing of yours calls it." >&2
        fi
    done
}

walk_rules_group() {
    local mode="$1"
    if [ "$VENDOR" -eq 1 ]; then
        walk_tree "$mode" "$SOURCE/rules" "$TARGET/rules"
    else
        walk_tree "$mode" "$STUB_SOURCE_DIR" "$(rules_stub_dir)"
    fi
}

walk_hooks_group() {
    local mode="$1"
    [ -f "$SOURCE/hooks/hooks.json" ] || { echo "Missing source asset: $SOURCE/hooks/hooks.json" >&2; exit 66; }
    walk_tree "$mode" "$SOURCE/hooks" "$TARGET/hooks"
    walk_tree "$mode" "$SOURCE/scripts/hooks" "$TARGET/scripts/hooks"
}

walk_scripts_group() {
    local mode="$1"
    walk_tree "$mode" "$SOURCE/scripts" "$TARGET/scripts"
    walk_tree "$mode" "$SOURCE/skills/precommit/scripts" "$TARGET/skills/precommit/scripts"
    walk_tree "$mode" "$SOURCE/skills/repo-verify/scripts" "$TARGET/skills/repo-verify/scripts"
}

walk_groups() {
    local mode="$1"
    case "$INSTALL" in
        hooks)
            walk_hooks_group "$mode"
            ;;
        rules)
            walk_rules_group "$mode"
            ;;
        scripts)
            walk_scripts_group "$mode"
            ;;
        all)
            walk_groups_for_all "$mode"
            ;;
    esac
}

walk_groups_for_all() {
    local mode="$1"
    walk_hooks_group "$mode"
    walk_rules_group "$mode"
    walk_scripts_group "$mode"
}

if [ "$INSTALL" = "scripts" ] || [ "$INSTALL" = "all" ]; then
    check_pilot_resources
    check_legacy_runner_conflicts
    report_legacy_resume_helpers
fi
report_legacy_vendored_rules
report_vendor_rules_copy

walk_groups check
if [ "$HAS_LEGACY_RUNNER_CONFLICT" -eq 1 ]; then
    echo "Installation aborted: reconcile unowned legacy runner files before installing the Skill-local pilot trees." >&2
    exit 3
fi
if [ "$HAS_UNSAFE_PILOT_SOURCE" -eq 1 ]; then
    echo "Installation aborted: pilot Skill resources must be physical files with no symlinked path components." >&2
    exit 4
fi
if [ "$HAS_MISSING_PILOT_RESOURCE" -eq 1 ]; then
    echo "Installation aborted: required pilot Skill resources are missing; no target files were changed." >&2
    exit 66
fi
if [ "$HAS_UNSAFE_SYMLINK" -eq 1 ] || [ "$HAS_UNSAFE_DESTINATION" -eq 1 ]; then
    echo "Installation aborted: destination path is unsafe." >&2
    exit 4
fi

if [ "$HAVE_PYTHON" -ne 1 ]; then
    if [ "$JSON" -eq 1 ]; then
        printf '%s\n' '{"exitCode":2,"message":"Python3 is required to classify assets against the Asset Receipt.","reasonCode":"PYTHON_UNAVAILABLE","schema":"dhpk.asset-plan.v1","verdict":"BLOCKED"}'
        echo "Plan aborted: Python3 is required to classify assets against the Asset Receipt." >&2
        exit 2
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
        if [ "$HAS_CONFLICT" -eq 1 ] && [ "$FORCE" -ne 1 ]; then
            echo "Installation aborted: resolve conflicts or re-run with --force." >&2
            exit 3
        fi
        echo "NOTE Python3 is unavailable: this dry run compares bytes only and does not consult the Asset Receipt." >&2
        walk_groups report
        exit 0
    fi
    echo "Installation aborted: Python3 is required for physical descriptor-relative asset installation." >&2
    exit 2
fi

walk_groups collect
if [ "$DRY_RUN" -eq 1 ]; then
    run_receipt_installer plan
    exit 0
fi
run_receipt_installer apply
if installs_rules_stub; then
    echo "Installed $INSTALL assets from $SOURCE to $TARGET (rules stub: $(rules_stub_path))"
else
    echo "Installed $INSTALL assets from $SOURCE to $TARGET"
fi
