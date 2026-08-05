#!/usr/bin/env bash
# Copy selected dhpk assets into a consumer project's .claude/dhpk directory.
# This is deliberately a small, deterministic installer: it never edits the
# consumer's settings and never overwrites differing files without --force.

set -eu

SCRIPT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$SCRIPT_ROOT"
TARGET=""
INSTALL=""
DRY_RUN=0
FORCE=0

usage() {
    cat <<'EOF'
Usage: install-assets.sh --install hooks|rules|scripts|all [--source DIR] [--target DIR] [--dry-run] [--force]

Copies selected source assets into TARGET (normally <project>/.claude/dhpk).
Differing destination files are conflicts and leave every file untouched unless
--force is supplied. --dry-run prints the complete plan without writing.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --install) INSTALL="${2:-}"; shift 2 ;;
        --source) SOURCE="${2:-}"; shift 2 ;;
        --target) TARGET="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --force) FORCE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
    esac
done

case "$INSTALL" in hooks|rules|scripts|all) ;; *) echo "--install is required" >&2; usage >&2; exit 64 ;; esac
[ -n "$TARGET" ] || { echo "--target is required" >&2; usage >&2; exit 64; }
[ -d "$SOURCE" ] || { echo "Source directory does not exist: $SOURCE" >&2; exit 66; }

HAS_CONFLICT=0
HAS_UNSAFE_SYMLINK=0

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
    while IFS= read -r -d '' source_file; do
        rel="${source_file#"$source_dir"/}"
        target_file="$target_dir/$rel"
        case "$mode" in
            check)
                if has_symlink_component "$target_file"; then
                    echo "UNSAFE SYMLINK $target_file (destination path escapes the selected target)" >&2
                    HAS_UNSAFE_SYMLINK=1
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
            copy)
                if [ -f "$target_file" ] && cmp -s "$source_file" "$target_file"; then
                    continue
                fi
                mkdir -p "$(dirname "$target_file")"
                cp "$source_file" "$target_file"
                if [ -x "$source_file" ]; then
                    chmod +x "$target_file"
                fi
                ;;
        esac
    done < <(find "$source_dir" -type f -print0)
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
            walk_tree "$mode" "$SOURCE/rules" "$TARGET/rules"
            ;;
        scripts)
            walk_tree "$mode" "$SOURCE/scripts" "$TARGET/scripts"
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
    walk_tree "$mode" "$SOURCE/rules" "$TARGET/rules"
    walk_tree "$mode" "$SOURCE/scripts" "$TARGET/scripts"
}

walk_groups check
if [ "$HAS_UNSAFE_SYMLINK" -eq 1 ]; then
    echo "Installation aborted: destination path contains a symlink." >&2
    exit 4
fi
if [ "$HAS_CONFLICT" -eq 1 ] && [ "$FORCE" -ne 1 ]; then
    echo "Installation aborted: resolve conflicts or re-run with --force." >&2
    exit 3
fi

walk_groups report
[ "$DRY_RUN" -eq 1 ] && exit 0
walk_groups copy
echo "Installed $INSTALL assets from $SOURCE to $TARGET"
