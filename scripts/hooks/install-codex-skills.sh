#!/usr/bin/env bash
# install-codex-skills.sh — sync the plugin's codex/ tree into a project's .codex/
#
# Why: Claude Code does not load anything under the plugin's codex/ directory.
# Codex CLI users run this script from a project root to symlink (default) or
# copy the plugin's Codex-format skills/agents into the project's .codex/.
#
# Usage:
#   install-codex-skills.sh                  symlink mode, refuse outside project root
#   install-codex-skills.sh --copy           copy mode (regular files, not symlinks)
#   install-codex-skills.sh --update         re-sync (overwrites symlinks/copies)
#   install-codex-skills.sh --force          bypass project-root heuristic
#
# Idempotency: writes .codex/.dhpk-installed.json with {plugin_version, mode,
# installed_at}. Re-running without --update is a no-op when the recorded
# version matches the plugin's current plugin.json version.

set -euo pipefail

MODE="symlink"
UPDATE=0
FORCE=0
for arg in "$@"; do
    case "$arg" in
        --copy) MODE="copy" ;;
        --update) UPDATE=1 ;;
        --force) FORCE=1 ;;
        --help|-h)
            sed -n '2,16p' "$0"
            exit 0 ;;
        *) echo "[install-codex-skills] unknown arg: $arg" >&2; exit 2 ;;
    esac
done

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
CODEX_SRC="$PLUGIN_ROOT/codex"

if [ ! -d "$CODEX_SRC" ]; then
    echo "[install-codex-skills] ERROR: plugin codex/ source not found at $CODEX_SRC" >&2
    exit 2
fi

PROJECT_ROOT="$(pwd)"

# Advisory: warn (but do not fail) if Codex CLI is missing — symlinks still get created.
if ! command -v codex >/dev/null 2>&1; then
    echo "[install-codex-skills] note: 'codex' CLI not found on PATH. Symlinks will be created anyway; install Codex CLI later to use them." >&2
fi

# Heuristic: project root has at least one of .git/, .claude/, package.json, composer.json.
if [ "$FORCE" -ne 1 ]; then
    if [ ! -e "$PROJECT_ROOT/.git" ] && [ ! -e "$PROJECT_ROOT/.claude" ] && \
       [ ! -e "$PROJECT_ROOT/package.json" ] && [ ! -e "$PROJECT_ROOT/composer.json" ]; then
        echo "[install-codex-skills] ERROR: '$PROJECT_ROOT' does not look like a project root." >&2
        echo "[install-codex-skills] Expected .git/, .claude/, package.json, or composer.json." >&2
        echo "[install-codex-skills] Re-run with --force to bypass this check." >&2
        exit 2
    fi
fi

# Read current plugin version.
PLUGIN_VERSION="unknown"
if command -v python3 >/dev/null 2>&1 && [ -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ]; then
    PLUGIN_VERSION="$(python3 -c "
import json, sys
try:
    print(json.load(open('$PLUGIN_ROOT/.claude-plugin/plugin.json'))['version'])
except Exception:
    print('unknown')
")"
fi

MANIFEST="$PROJECT_ROOT/.codex/.dhpk-installed.json"

# Version alone cannot detect source edits made during plugin development. Use a
# deterministic content fingerprint for the Codex skills/agents tree; the
# version remains part of the manifest for human-readable provenance.
PLUGIN_FINGERPRINT=""
if command -v python3 >/dev/null 2>&1; then
    PLUGIN_FINGERPRINT="$(CODEX_SRC="$CODEX_SRC" python3 - <<'PY'
import hashlib
import os

root = os.environ['CODEX_SRC']
digest = hashlib.sha256()

def visit(path, relative):
    # Follow directory symlinks: codex/skills contains deliberate links to
    # canonical skills/, and their target content is part of the install surface.
    if os.path.isdir(path):
        for name in sorted(os.listdir(path)):
            visit(os.path.join(path, name), os.path.join(relative, name))
        return
    if not os.path.isfile(path):
        return
    digest.update(relative.replace(os.sep, '/').encode('utf-8'))
    digest.update(b'\0')
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            digest.update(chunk)

for name in ('skills', 'agents'):
    visit(os.path.join(root, name), name)
print(digest.hexdigest())
PY
)"
fi

# Idempotency check.
if [ "$UPDATE" -ne 1 ] && [ -f "$MANIFEST" ] && command -v python3 >/dev/null 2>&1; then
    installed_version="$(python3 -c "
import json
try:
    print(json.load(open('$MANIFEST'))['plugin_version'])
except Exception:
    print('')
")"
    installed_fingerprint="$(python3 -c "
import json
try:
    print(json.load(open('$MANIFEST'))['source_fingerprint'])
except Exception:
    print('')
")"
    if [ -n "$PLUGIN_FINGERPRINT" ] && [ "$installed_version" = "$PLUGIN_VERSION" ] && [ "$installed_fingerprint" = "$PLUGIN_FINGERPRINT" ]; then
        echo "[install-codex-skills] already up-to-date for dhpk v$PLUGIN_VERSION"
        exit 0
    fi
fi

mkdir -p "$PROJECT_ROOT/.codex/skills" "$PROJECT_ROOT/.codex/agents"

_sync_dir() {
    local src="$1" dst="$2"
    [ -d "$src" ] || return 0
    for item in "$src"/*; do
        [ -e "$item" ] || continue
        local name="$(basename "$item")"
        local target="$dst/$name"
        if [ -e "$target" ] || [ -L "$target" ]; then
            rm -rf "$target"
        fi
        if [ "$MODE" = "copy" ]; then
            # -L follows symlinks so in-repo symlinked entries under codex/skills/
            # (which point at the canonical ../../skills/<name>/) get materialised
            # as real files in the consumer project, not as dead relative symlinks.
            cp -RL "$item" "$target"
        else
            ln -s "$item" "$target"
        fi
    done
}

_sync_dir "$CODEX_SRC/skills" "$PROJECT_ROOT/.codex/skills"
_sync_dir "$CODEX_SRC/agents" "$PROJECT_ROOT/.codex/agents"

# config.toml.example: copy as example only; never overwrite an existing config.toml.
if [ -f "$CODEX_SRC/config.toml.example" ]; then
    cp -f "$CODEX_SRC/config.toml.example" "$PROJECT_ROOT/.codex/config.toml.example"
fi

# Write manifest.
INSTALLED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
cat > "$MANIFEST" <<EOF
{
  "plugin_version": "$PLUGIN_VERSION",
  "source_fingerprint": "$PLUGIN_FINGERPRINT",
  "mode": "$MODE",
  "installed_at": "$INSTALLED_AT"
}
EOF

echo "[install-codex-skills] synced dhpk v$PLUGIN_VERSION codex/ → $PROJECT_ROOT/.codex/ (mode=$MODE)"
exit 0
