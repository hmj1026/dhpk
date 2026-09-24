#!/usr/bin/env bash
# Copy selected dhpk assets into a consumer project's .claude/dhpk directory.
# This is deliberately a small, deterministic installer: it never edits the
# consumer's settings and never overwrites differing files without --force.
# Default --install rules writes a project-delta stub beside TARGET rather
# than copying upstream policy; --vendor restores the legacy verbatim copy.

set -eu

SCRIPT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$SCRIPT_ROOT"
TARGET=""
INSTALL=""
DRY_RUN=0
FORCE=0
VENDOR=0
RULES_STUB_NAME="dhpk-overrides.md"
STUB_SOURCE_DIR=""

usage() {
    cat <<'EOF'
Usage: install-assets.sh --install hooks|rules|scripts|all [--source DIR] [--target DIR] [--dry-run] [--force] [--vendor]

Copies selected source assets into TARGET (normally <project>/.claude/dhpk).
Default --install rules|all writes <parent-of-TARGET>/rules/dhpk-overrides.md
instead of copying upstream policy into TARGET/rules. --vendor restores that
verbatim copy and is discouraged. Differing destination files are conflicts
and leave every file untouched unless --force is supplied. --dry-run prints
the complete plan without writing.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --install) INSTALL="${2:-}"; shift 2 ;;
        --source) SOURCE="${2:-}"; shift 2 ;;
        --target) TARGET="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --force) FORCE=1; shift ;;
        --vendor) VENDOR=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
    esac
done

case "$INSTALL" in hooks|rules|scripts|all) ;; *) echo "--install is required" >&2; usage >&2; exit 64 ;; esac
[ -n "$TARGET" ] || { echo "--target is required" >&2; usage >&2; exit 64; }
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

HAS_CONFLICT=0
HAS_UNSAFE_SYMLINK=0
HAS_UNSAFE_DESTINATION=0
HAS_MISSING_PILOT_RESOURCE=0
HAS_UNSAFE_PILOT_SOURCE=0
HAS_LEGACY_RUNNER_CONFLICT=0

has_symlink_component() {
    local candidate="$1"
    while [ "$candidate" != "/" ] && [ "$candidate" != "." ]; do
        [ -L "$candidate" ] && return 0
        candidate="$(dirname "$candidate")"
    done
    return 1
}

walk_tree() {
    local mode="$1" source_dir="$2" target_dir="$3" source_file rel target_file prefix=""
    [ -d "$source_dir" ] || { echo "Missing source asset directory: $source_dir" >&2; exit 66; }
    if [ "$mode" = "copy" ]; then
        local -a skip_relatives=("")
        if [ "$target_dir" = "$TARGET/scripts" ]; then
            skip_relatives=(precommit-runner.js verify-runner.js harness-audit.js)
        fi
        python3 -I -S - "$source_dir" "$target_dir" "$FORCE" "${skip_relatives[@]}" <<'PY'
import errno
import inspect
import os
import stat
import sys


class InstallerFailure(Exception):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def failure(message, code):
    raise InstallerFailure(message, code)


def validate_component(component, label):
    if not component or component in ('.', '..') or '/' in component or '\\' in component or '\x00' in component:
        failure('UNSAFE DESTINATION {} contains an unsafe path component'.format(label), 4)


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


def physical_root(path, create, label):
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
            if error.errno == errno.ELOOP:
                failure('UNSAFE SYMLINK {} contains a symlinked directory component'.format(label), 4)
            failure('UNSAFE DESTINATION {} cannot open directory: {}'.format(label, error), 4)
    except OSError as error:
        if error.errno == errno.ELOOP:
            failure('UNSAFE SYMLINK {} contains a symlinked directory component'.format(label), 4)
        if error.errno == errno.ENOTDIR:
            failure('UNSAFE DESTINATION {} contains a non-directory component'.format(label), 4)
        failure('UNSAFE DESTINATION {} cannot open directory: {}'.format(label, error), 4)


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


def compare_files(source_fd, source_size, destination_fd, destination_size):
    if source_size != destination_size:
        return False
    os.lseek(source_fd, 0, os.SEEK_SET)
    os.lseek(destination_fd, 0, os.SEEK_SET)
    while True:
        source_chunk = os.read(source_fd, 1024 * 1024)
        destination_chunk = os.read(destination_fd, len(source_chunk))
        if source_chunk != destination_chunk:
            return False
        if not source_chunk:
            return True


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
    except FileNotFoundError:
        pass
    except OSError:
        pass


def copy_one(source_parent_fd, source_name, target_root_fd, relative, force):
    components = relative.split('/')
    for component in components:
        validate_component(component, relative)
    target_parent_fd = open_relative_directory(
        target_root_fd,
        components[:-1],
        True,
        'destination parent {}'.format(relative),
    )
    leaf = components[-1]
    source_fd = None
    destination_fd = None
    stage_fd = None
    stage_name = None
    try:
        try:
            source_fd = os.open(source_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source_parent_fd)
        except OSError as error:
            if error.errno == errno.ELOOP:
                failure('UNSAFE SYMLINK source {} is a symlink'.format(relative), 4)
            failure('UNSAFE SOURCE {} cannot be opened: {}'.format(relative, error), 4)
        source_before = os.fstat(source_fd)
        if not stat.S_ISREG(source_before.st_mode):
            failure('UNSAFE SOURCE {} is not a regular file'.format(relative), 4)
        existing = leaf_stat(target_parent_fd, leaf, relative)
        if existing is not None:
            if stat.S_ISLNK(existing.st_mode):
                failure('UNSAFE SYMLINK {} is a symlink'.format(relative), 4)
            if not stat.S_ISREG(existing.st_mode):
                failure('UNSAFE DESTINATION {} is not a regular file'.format(relative), 4)
            try:
                destination_fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=target_parent_fd)
            except OSError as error:
                if error.errno == errno.ELOOP:
                    failure('UNSAFE SYMLINK {} is a symlink'.format(relative), 4)
                failure('UNSAFE DESTINATION {} cannot be opened: {}'.format(relative, error), 4)
            if compare_files(source_fd, source_before.st_size, destination_fd, existing.st_size):
                return
            if not force:
                failure('CONFLICT {} (source file differs)'.format(relative), 3)
        if destination_fd is not None:
            os.close(destination_fd)
            destination_fd = None
        os.lseek(source_fd, 0, os.SEEK_SET)
        stage_name, stage_fd = create_stage(target_parent_fd, stat.S_IMODE(source_before.st_mode))
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            view = memoryview(chunk)
            while view:
                count = os.write(stage_fd, view)
                view = view[count:]
        os.fchmod(stage_fd, stat.S_IMODE(source_before.st_mode))
        os.fsync(stage_fd)
        staged = os.fstat(stage_fd)
        source_after = os.fstat(source_fd)
        if (source_before.st_dev, source_before.st_ino, source_before.st_size) != (
            source_after.st_dev, source_after.st_ino, source_after.st_size
        ):
            failure('UNSAFE SOURCE {} changed while staging'.format(relative), 4)
        os.close(stage_fd)
        stage_fd = None
        current = leaf_stat(target_parent_fd, leaf, relative)
        if existing is None:
            if current is not None:
                if stat.S_ISLNK(current.st_mode):
                    failure('UNSAFE SYMLINK {} appeared during staging'.format(relative), 4)
                failure('UNSAFE DESTINATION {} appeared during staging'.format(relative), 4)
        else:
            if current is None or (current.st_dev, current.st_ino) != (existing.st_dev, existing.st_ino):
                failure('UNSAFE DESTINATION {} changed during staging'.format(relative), 4)
            if stat.S_ISLNK(current.st_mode) or not stat.S_ISREG(current.st_mode):
                failure('UNSAFE DESTINATION {} changed to a non-regular entry'.format(relative), 4)
        try:
            os.replace(stage_name, leaf, src_dir_fd=target_parent_fd, dst_dir_fd=target_parent_fd)
        except OSError as error:
            failure('UNSAFE DESTINATION {} could not be published: {}'.format(relative, error), 4)
        stage_name = None
        published = leaf_stat(target_parent_fd, leaf, relative)
        if published is None or stat.S_ISLNK(published.st_mode) or not stat.S_ISREG(published.st_mode):
            failure('UNSAFE DESTINATION {} is not a regular published file'.format(relative), 4)
        if (published.st_dev, published.st_ino) != (staged.st_dev, staged.st_ino):
            failure('UNSAFE DESTINATION {} published inode changed'.format(relative), 4)
        os.fsync(target_parent_fd)
    finally:
        if destination_fd is not None:
            os.close(destination_fd)
        if stage_fd is not None:
            os.close(stage_fd)
        if stage_name is not None:
            remove_stage(target_parent_fd, stage_name)
        if source_fd is not None:
            os.close(source_fd)
        os.close(target_parent_fd)


def walk_source(source_fd, target_root_fd, relative, force, skips):
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
                walk_source(child_fd, target_root_fd, child_relative, force, skips)
            finally:
                os.close(child_fd)
        elif stat.S_ISREG(child_stat.st_mode):
            if child_relative in skips:
                continue
            copy_one(source_fd, name, target_root_fd, child_relative, force)


def main():
    if len(sys.argv) < 4:
        failure('UNSAFE DESTINATION invalid copy arguments', 4)
    source_path = sys.argv[1]
    target_path = sys.argv[2]
    force = sys.argv[3] == '1'
    skips = set(sys.argv[4:])
    require_capabilities()
    source_fd = physical_root(source_path, False, 'source')
    target_fd = None
    try:
        target_fd = physical_root(target_path, True, 'destination')
        walk_source(source_fd, target_fd, '', force, skips)
    finally:
        os.close(source_fd)
        if target_fd is not None:
            os.close(target_fd)


if __name__ == '__main__':
    try:
        main()
    except InstallerFailure as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(error.code)
    except Exception as error:
        print('UNSAFE DESTINATION installer copy failed: {}'.format(error), file=sys.stderr)
        raise SystemExit(4)
PY
        return
    fi
    while IFS= read -r -d '' source_file; do
        rel="${source_file#"$source_dir"/}"
        target_file="$target_dir/$rel"
        if [ "$target_dir" = "$TARGET/scripts" ]; then
            case "$rel" in
                precommit-runner.js|verify-runner.js|harness-audit.js)
                    echo "SKIP $target_file (legacy runner path removed; use the Skill-local runner tree)"
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
                    echo "CONFLICT $target_file (source: $source_file)" >&2
                    HAS_CONFLICT=1
                fi
                ;;
            report)
                if [ "$DRY_RUN" -eq 1 ]; then prefix="DRY-RUN "; fi
                if [ -f "$target_file" ] && cmp -s "$source_file" "$target_file"; then
                    echo "SKIP $target_file (identical)"
                elif [ -f "$target_file" ]; then
                    echo "${prefix}OVERWRITE $target_file (source: $source_file)"
                else
                    echo "${prefix}COPY $target_file (source: $source_file)"
                fi
                ;;
        esac
    done < <(find "$source_dir" -type f -print0)
}

check_pilot_resources() {
    local skill runner source_file
    for skill in precommit repo-verify harness-audit; do
        case "$skill" in
            precommit) runner="precommit-runner.js" ;;
            repo-verify) runner="verify-runner.js" ;;
            harness-audit) runner="harness-audit.js" ;;
        esac
        for source_file in "$SOURCE/skills/$skill/scripts/$runner"; do
            if [ ! -f "$source_file" ]; then
                echo "Missing required Skill resource: $source_file" >&2
                HAS_MISSING_PILOT_RESOURCE=1
            elif has_symlink_component "$source_file"; then
                echo "UNSAFE SOURCE $source_file (Skill resources must use a physical non-symlink path)" >&2
                HAS_UNSAFE_PILOT_SOURCE=1
            fi
        done
        if [ "$skill" = "harness-audit" ]; then
            continue
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

walk_groups() {
    local mode="$1"
    case "$INSTALL" in
        hooks)
            [ -f "$SOURCE/hooks/hooks.json" ] || { echo "Missing source asset: $SOURCE/hooks/hooks.json" >&2; exit 66; }
            walk_tree "$mode" "$SOURCE/hooks" "$TARGET/hooks"
            walk_tree "$mode" "$SOURCE/scripts/hooks" "$TARGET/scripts/hooks"
            ;;
        rules)
            walk_rules_group "$mode"
            ;;
        scripts)
            walk_tree "$mode" "$SOURCE/scripts" "$TARGET/scripts"
            walk_tree "$mode" "$SOURCE/skills/precommit/scripts" "$TARGET/skills/precommit/scripts"
            walk_tree "$mode" "$SOURCE/skills/repo-verify/scripts" "$TARGET/skills/repo-verify/scripts"
            walk_tree "$mode" "$SOURCE/skills/harness-audit/scripts" "$TARGET/skills/harness-audit/scripts"
            ;;
        all)
            walk_groups_for_all "$mode"
            ;;
    esac
}

walk_groups_for_all() {
    local mode="$1"
    [ -f "$SOURCE/hooks/hooks.json" ] || { echo "Missing source asset: $SOURCE/hooks/hooks.json" >&2; exit 66; }
    walk_tree "$mode" "$SOURCE/hooks" "$TARGET/hooks"
    walk_tree "$mode" "$SOURCE/scripts/hooks" "$TARGET/scripts/hooks"
    walk_rules_group "$mode"
    walk_tree "$mode" "$SOURCE/scripts" "$TARGET/scripts"
    walk_tree "$mode" "$SOURCE/skills/precommit/scripts" "$TARGET/skills/precommit/scripts"
    walk_tree "$mode" "$SOURCE/skills/repo-verify/scripts" "$TARGET/skills/repo-verify/scripts"
    walk_tree "$mode" "$SOURCE/skills/harness-audit/scripts" "$TARGET/skills/harness-audit/scripts"
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
if [ "$HAS_CONFLICT" -eq 1 ] && [ "$FORCE" -ne 1 ]; then
    echo "Installation aborted: resolve conflicts or re-run with --force." >&2
    exit 3
fi

walk_groups report
[ "$DRY_RUN" -eq 1 ] && exit 0
if ! command -v python3 >/dev/null 2>&1; then
    echo "Installation aborted: Python3 is required for physical descriptor-relative asset installation." >&2
    exit 2
fi
walk_groups copy
if installs_rules_stub; then
    echo "Installed $INSTALL assets from $SOURCE to $TARGET (rules stub: $(rules_stub_path))"
else
    echo "Installed $INSTALL assets from $SOURCE to $TARGET"
fi
