#!/usr/bin/env bash
# install-codex-skills.sh — safely sync the plugin's codex/ tree into a
# project's .codex/ directory.
#
# Usage:
#   install-codex-skills.sh                  symlink mode
#   install-codex-skills.sh --copy           materialise regular files
#   install-codex-skills.sh --update         reconcile an existing receipt
#   install-codex-skills.sh --migrate        adopt exact legacy destinations
#   install-codex-skills.sh --uninstall       remove unchanged owned entries
#   install-codex-skills.sh --force          bypass project-root heuristic
#
# The receipt is schema-versioned and records every managed skill, agent, and
# supporting asset.  The embedded Python program is deliberately static: all
# filesystem paths arrive through environment variables so apostrophes and
# other valid path characters cannot become generated Python syntax.

set -euo pipefail

MODE="symlink"
UPDATE=0
FORCE=0
MIGRATE=0
UNINSTALL=0
for arg in "$@"; do
    case "$arg" in
        --copy) MODE="copy" ;;
        --update) UPDATE=1 ;;
        --migrate) MIGRATE=1 ;;
        --uninstall) UNINSTALL=1 ;;
        --force) FORCE=1 ;;
        --help|-h)
            sed -n '2,15p' "$0"
            exit 0 ;;
        *) echo "[install-codex-skills] unknown arg: $arg" >&2; exit 2 ;;
    esac
done

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
CODEX_SRC="$PLUGIN_ROOT/codex"
PROJECT_ROOT="$(pwd)"

if [ ! -d "$CODEX_SRC" ]; then
    echo "[install-codex-skills] ERROR: plugin codex/ source not found" >&2
    exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "[install-codex-skills] ERROR: python3 is required for receipt reconciliation" >&2
    exit 2
fi

if [ "$FORCE" -ne 1 ] && [ "$UNINSTALL" -ne 1 ]; then
    if [ ! -e "$PROJECT_ROOT/.git" ] && [ ! -e "$PROJECT_ROOT/.claude" ] && \
       [ ! -e "$PROJECT_ROOT/package.json" ] && [ ! -e "$PROJECT_ROOT/composer.json" ]; then
        echo "[install-codex-skills] ERROR: '$PROJECT_ROOT' does not look like a project root." >&2
        echo "[install-codex-skills] Re-run with --force to bypass this check." >&2
        exit 2
    fi
fi

if ! command -v codex >/dev/null 2>&1 && [ "$UNINSTALL" -ne 1 ]; then
    echo "[install-codex-skills] note: 'codex' CLI not found on PATH; files can still be synced." >&2
fi

export DHPK_PLUGIN_ROOT="$PLUGIN_ROOT"
export DHPK_PROJECT_ROOT="$PROJECT_ROOT"
export DHPK_MODE="$MODE"
export DHPK_UPDATE="$UPDATE"
export DHPK_MIGRATE="$MIGRATE"
export DHPK_UNINSTALL="$UNINSTALL"

python3 - <<'PY'
import datetime
import hashlib
import json
import os
import shutil
import sys
import tempfile

PLUGIN_ROOT = os.environ['DHPK_PLUGIN_ROOT']
PROJECT_ROOT = os.environ['DHPK_PROJECT_ROOT']
CODEX_SRC = os.path.join(PLUGIN_ROOT, 'codex')
CODEX_ROOT = os.path.join(PROJECT_ROOT, '.codex')
MANIFEST = os.path.join(CODEX_ROOT, '.dhpk-installed.json')
MODE = os.environ.get('DHPK_MODE', 'symlink')
UPDATE = os.environ.get('DHPK_UPDATE') == '1'
MIGRATE = os.environ.get('DHPK_MIGRATE') == '1'
UNINSTALL = os.environ.get('DHPK_UNINSTALL') == '1'
SCHEMA_VERSION = 2


def lexists(path):
    return os.path.lexists(path)


def is_within(path, root):
    path = os.path.realpath(path)
    root = os.path.realpath(root)
    return path == root or path.startswith(root + os.sep)


def ensure_codex_root_safe():
    if lexists(CODEX_ROOT) and os.path.islink(CODEX_ROOT):
        raise ValueError('project .codex is a symlink; refusing to mutate outside the project')


def ensure_manifest_safe():
    ensure_codex_root_safe()
    if not lexists(MANIFEST):
        return
    if os.path.islink(MANIFEST):
        raise ValueError('project .codex receipt is a symlink; refusing to follow it')
    if not os.path.isfile(MANIFEST):
        raise ValueError('project .codex receipt is not a regular file; refusing to mutate it')


def safe_destination(relative):
    if not isinstance(relative, str) or not relative or '\x00' in relative:
        raise ValueError('receipt destination is not a valid relative path')
    normalized = os.path.normpath(relative).replace(os.sep, '/')
    if os.path.isabs(relative) or normalized != relative or normalized == '..' or normalized.startswith('../'):
        raise ValueError(f'receipt destination escapes project .codex: {relative}')
    ensure_codex_root_safe()
    destination = os.path.join(CODEX_ROOT, *relative.split('/'))
    root_real = os.path.realpath(CODEX_ROOT)
    if not is_within(os.path.dirname(destination), root_real):
        raise ValueError(f'receipt destination parent escapes project .codex: {relative}')
    if lexists(destination) and not os.path.islink(destination) and not is_within(destination, root_real):
        raise ValueError(f'receipt destination escapes project .codex: {relative}')
    return destination


def receipt_destination(kind, name, old):
    expected = 'config.toml.example' if kind == 'supporting_assets' else f'{kind}/{name}'
    if not isinstance(old, dict):
        raise ValueError(f'receipt entry {kind}/{name} is malformed')
    relative = old.get('destination') or old.get('source')
    if relative != expected or old.get('source') not in (None, expected):
        raise ValueError(f'receipt entry {kind}/{name} has an unexpected destination')
    return safe_destination(expected)


def remove_path(path):
    if not lexists(path):
        return
    if os.path.islink(path) or not os.path.isdir(path):
        os.unlink(path)
    else:
        shutil.rmtree(path)


def hash_path(path):
    """Hash a file or directory deterministically, following source links."""
    digest = hashlib.sha256()
    if os.path.islink(path):
        target = os.path.realpath(path)
        return hash_path(target)
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
        child = os.path.join(path, name)
        digest.update(name.replace(os.sep, '/').encode('utf-8'))
        digest.update(b'\0')
        digest.update(hash_path(child).encode('ascii'))
        digest.update(b'\0')
    return digest.hexdigest()


def source_fingerprint():
    digest = hashlib.sha256()
    for root_name in ('skills', 'agents'):
        root = os.path.join(CODEX_SRC, root_name)
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            child = os.path.join(root, name)
            digest.update(f'{root_name}/{name}'.encode('utf-8'))
            digest.update(b'\0')
            digest.update(hash_path(child).encode('ascii'))
            digest.update(b'\0')
    supporting = os.path.join(CODEX_SRC, 'config.toml.example')
    if os.path.isfile(supporting):
        digest.update(b'config.toml.example\0')
        digest.update(hash_path(supporting).encode('ascii'))
    return digest.hexdigest()


def read_plugin_version():
    path = os.path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh).get('version', 'unknown')
    except Exception:
        return 'unknown'


def read_receipt():
    ensure_manifest_safe()
    if not lexists(MANIFEST):
        return {}, False
    try:
        with open(MANIFEST, encoding='utf-8') as fh:
            receipt = json.load(fh)
    except Exception:
        return {}, True
    entries = receipt.get('managed_entries')
    return receipt, not isinstance(entries, dict)


def entry_map(receipt):
    managed = receipt.get('managed_entries') if isinstance(receipt, dict) else None
    managed = managed if isinstance(managed, dict) else {}
    return {
        'skills': dict(managed.get('skills') or {}),
        'agents': dict(managed.get('agents') or {}),
        'supporting_assets': dict(managed.get('supporting_assets') or {}),
    }


def current_sources():
    result = {'skills': {}, 'agents': {}, 'supporting_assets': {}}
    for kind in ('skills', 'agents'):
        root = os.path.join(CODEX_SRC, kind)
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            source = os.path.join(root, name)
            if not lexists(source):
                continue
            result[kind][name] = (source, f'{kind}/{name}')
    supporting = os.path.join(CODEX_SRC, 'config.toml.example')
    if os.path.isfile(supporting):
        result['supporting_assets']['config.toml.example'] = (supporting, 'config.toml.example')
    return result


def target_for(relative):
    return safe_destination(relative)


def make_entry(source, relative, destination):
    source_fp = hash_path(source)
    destination_fp = hash_path(destination)
    marker = f'{MODE}:{relative}'
    entry = {
        'destination': relative,
        'source': relative,
        'mode': MODE,
        'source_fingerprint': source_fp,
        'destination_fingerprint': destination_fp,
        'ownership_marker': marker,
    }
    if MODE == 'symlink':
        entry['destination_target'] = os.readlink(destination)
    return entry


def is_owned(entry, destination):
    if not isinstance(entry, dict) or not lexists(destination):
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
    recorded = entry.get('destination_fingerprint')
    return bool(recorded) and hash_path(destination) == recorded


def exact_source_match(source, destination):
    if not lexists(destination):
        return False
    if os.path.islink(destination):
        return os.path.realpath(destination) == os.path.realpath(source)
    return hash_path(source) == hash_path(destination)


def install(source, destination):
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    remove_path(destination)
    if MODE == 'symlink':
        os.symlink(source, destination, target_is_directory=os.path.isdir(source))
    elif os.path.isdir(source):
        shutil.copytree(source, destination, symlinks=False)
    else:
        shutil.copy2(source, destination)


def save_receipt(plugin_version, fingerprint, entries, orphaned, counts, legacy_pending=False):
    ensure_manifest_safe()
    os.makedirs(CODEX_ROOT, exist_ok=True)
    receipt = {
        'schema_version': SCHEMA_VERSION,
        'plugin_version': plugin_version,
        'source_fingerprint': fingerprint,
        'mode': MODE,
        'installed_at': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z',
        'managed_entries': entries,
        'orphaned_entries': orphaned,
        'reconciliation': counts,
    }
    if legacy_pending:
        receipt['legacy_pending'] = True
    fd, temporary = tempfile.mkstemp(prefix='.dhpk-installed.json.', dir=CODEX_ROOT)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(receipt, fh, indent=2, sort_keys=True)
            fh.write('\n')
        os.replace(temporary, MANIFEST)
    finally:
        if lexists(temporary):
            os.unlink(temporary)
    return receipt


def print_summary(counts, collisions, orphaned):
    print('[install-codex-skills] reconciliation: ' + ', '.join(f'{k}={counts[k]}' for k in (
        'created', 'updated', 'preserved', 'skipped_collision', 'pruned', 'orphaned')))
    for relative in sorted(collisions):
        print(f'[install-codex-skills] collision preserved: {relative}')
    for relative in sorted(orphaned):
        print(f'[install-codex-skills] orphaned preserved: {relative}')


plugin_version = read_plugin_version()
fingerprint = source_fingerprint()
try:
    receipt, legacy = read_receipt()
except ValueError as error:
    print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
    sys.exit(2)
legacy_pending = bool(legacy or (isinstance(receipt, dict) and receipt.get('legacy_pending')))
entries = entry_map(receipt)
orphaned = dict(receipt.get('orphaned_entries') or {}) if isinstance(receipt, dict) else {}
counts = {k: 0 for k in ('created', 'updated', 'preserved', 'skipped_collision', 'pruned', 'orphaned')}
collisions = []

if UNINSTALL:
    try:
        ensure_codex_root_safe()
    except ValueError as error:
        print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
        sys.exit(2)
    if not entries and not orphaned:
        if os.path.isfile(MANIFEST):
            os.unlink(MANIFEST)
        print('[install-codex-skills] no managed receipt entries to uninstall')
        sys.exit(0)
    remaining = {'skills': {}, 'agents': {}, 'supporting_assets': {}}
    for kind in ('skills', 'agents', 'supporting_assets'):
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
                remove_path(destination)
                counts['pruned'] += 1
            else:
                remaining[kind][name] = dict(old, orphaned=True)
                orphaned[relative] = dict(old, reason='modified-before-uninstall')
                counts['orphaned'] += 1
    if not orphaned and not any(remaining[kind] for kind in remaining):
        if os.path.isfile(MANIFEST):
            os.unlink(MANIFEST)
    else:
        save_receipt(plugin_version, fingerprint, remaining, orphaned, counts, legacy_pending=legacy_pending)
    print_summary(counts, collisions, sorted(orphaned))
    sys.exit(0)

prior_reconciliation = receipt.get('reconciliation') if isinstance(receipt, dict) else {}
has_pending_conflicts = bool(orphaned) or bool(isinstance(prior_reconciliation, dict) and prior_reconciliation.get('skipped_collision'))
if not UPDATE and not MIGRATE and not legacy and not has_pending_conflicts and receipt.get('plugin_version') == plugin_version and receipt.get('source_fingerprint') == fingerprint:
    print(f'[install-codex-skills] already up-to-date for dhpk v{plugin_version}')
    sys.exit(0)

try:
    ensure_codex_root_safe()
except ValueError as error:
    print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
    sys.exit(2)
os.makedirs(os.path.join(CODEX_ROOT, 'skills'), exist_ok=True)
os.makedirs(os.path.join(CODEX_ROOT, 'agents'), exist_ok=True)
sources = current_sources()

# Reconcile entries removed from the source only during an explicit update.
if UPDATE:
    for kind in ('skills', 'agents', 'supporting_assets'):
        for name in list(entries[kind]):
            if name in sources[kind]:
                continue
            old = entries[kind][name]
            relative = (old.get('destination') or old.get('source')) if isinstance(old, dict) else f'{kind}/{name}'
            relative = relative or f'{kind}/{name}'
            try:
                destination = receipt_destination(kind, name, old)
            except ValueError as error:
                entries[kind][name] = dict(old, orphaned=True) if isinstance(old, dict) else {'destination': relative, 'orphaned': True}
                orphaned[relative] = dict(entries[kind][name], reason='unsafe-receipt-path')
                counts['orphaned'] += 1
                print(f'[install-codex-skills] orphaned preserved: {relative} ({error})')
                continue
            if not lexists(destination):
                del entries[kind][name]
            elif is_owned(old, destination):
                remove_path(destination)
                del entries[kind][name]
                counts['pruned'] += 1
            else:
                entries[kind][name] = dict(old, orphaned=True)
                orphaned[relative] = dict(old, reason='modified-removed-source')
                counts['orphaned'] += 1

for kind in ('skills', 'agents', 'supporting_assets'):
    for name, (source, relative) in sources[kind].items():
        try:
            destination = target_for(relative)
        except ValueError as error:
            print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
            sys.exit(2)
        old = entries[kind].get(name)
        if lexists(destination):
            owned = is_owned(old, destination)
            adopted = False
            if legacy_pending and MIGRATE and exact_source_match(source, destination):
                entries[kind][name] = make_entry(source, relative, destination)
                adopted = True
                counts['preserved'] += 1
            if adopted:
                continue
            if not owned:
                collisions.append(relative)
                counts['skipped_collision'] += 1
                counts['preserved'] += 1
                continue
            if old.get('orphaned'):
                collisions.append(relative)
                counts['skipped_collision'] += 1
                counts['preserved'] += 1
                continue
            install(source, destination)
            entries[kind][name] = make_entry(source, relative, destination)
            counts['updated'] += 1
        else:
            install(source, destination)
            entries[kind][name] = make_entry(source, relative, destination)
            counts['created'] += 1

if legacy_pending and MIGRATE and not collisions:
    legacy_pending = False
save_receipt(plugin_version, fingerprint, entries, orphaned, counts, legacy_pending=legacy_pending)
print_summary(counts, collisions, sorted(orphaned))
print(f'[install-codex-skills] synced dhpk v{plugin_version} codex/ → project-local .codex/ (mode={MODE})')
PY
