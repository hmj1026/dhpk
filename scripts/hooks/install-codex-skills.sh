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
SCHEMA_VERSION = 3
BACKUP_DIR = '.dhpk-backups'
BACKUP_RUN = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ') + f'-{os.getpid()}'

# These collections are populated by the reconciliation pass and persisted in
# the receipt as durable evidence. Paths are always relative to the project or
# `.codex` root so a receipt remains useful after a checkout moves.
evidence_paths = {
    'created': [],
    'updated': [],
    'migrated': [],
    'retired': [],
    'collisions': [],
    'orphaned': [],
}
evidence_ownership = {}
backup_records = []


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
    if not isinstance(relative, str) or not relative or '\x00' in relative or '\\' in relative:
        raise ValueError('receipt destination is not a valid relative path')
    normalized = os.path.normpath(relative).replace(os.sep, '/')
    if os.path.isabs(relative) or (len(relative) > 1 and relative[1] == ':') or normalized != relative or normalized in ('.', '..') or normalized.startswith('../'):
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
    expected = name if kind == 'supporting_assets' else f'{kind}/{name}'
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


def backup_destination(relative, destination, reason):
    """Copy a proven managed target into a rollback-addressable project path."""
    if not lexists(destination):
        return None
    backup_root = os.path.join(CODEX_ROOT, BACKUP_DIR, BACKUP_RUN)
    backup = os.path.join(backup_root, *relative.split('/'))
    os.makedirs(os.path.dirname(backup), exist_ok=True)
    if os.path.islink(destination):
        os.symlink(os.readlink(destination), backup, target_is_directory=os.path.isdir(destination))
    elif os.path.isdir(destination):
        shutil.copytree(destination, backup, symlinks=True)
    else:
        shutil.copy2(destination, backup)
    backup_relative = f'.codex/{BACKUP_DIR}/{BACKUP_RUN}/{relative}'
    backup_records.append({
        'path': backup_relative,
        'original': relative,
        'reason': reason,
        'fingerprint': hash_path(destination),
    })
    record_path('backed_up', relative)
    return backup_relative


def is_ignored_distribution_name(name):
    """Return whether a generated/non-portable entry must be excluded."""
    return name == '__pycache__' or name.endswith('.pyc')


def ignore_distribution_entries(path, names):
    """Ignore generated Python bytecode during distributable copytree walks."""
    return {name for name in names if is_ignored_distribution_name(name)}


def hash_path(path):
    """Hash a file or directory deterministically, following source links."""
    digest = hashlib.sha256()
    if os.path.islink(path):
        target = os.path.realpath(path)
        return hash_path(target)
    if is_ignored_distribution_name(os.path.basename(path)):
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
        if is_ignored_distribution_name(name):
            continue
        child = os.path.join(path, name)
        digest.update(name.replace(os.sep, '/').encode('utf-8'))
        digest.update(b'\0')
        digest.update(hash_path(child).encode('ascii'))
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
        source = os.path.join(PLUGIN_ROOT, *source_rel.split('/'))
        if not is_within(source, PLUGIN_ROOT) or not lexists(source):
            raise ValueError(f'supporting asset source is missing or escapes the plugin root: {source_rel}')
        result[destination] = (source, destination)
    return result


def source_fingerprint():
    digest = hashlib.sha256()
    for root_name in ('skills', 'agents'):
        root = os.path.join(CODEX_SRC, root_name)
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            if is_ignored_distribution_name(name):
                continue
            child = os.path.join(root, name)
            digest.update(f'{root_name}/{name}'.encode('utf-8'))
            digest.update(b'\0')
            digest.update(hash_path(child).encode('ascii'))
            digest.update(b'\0')
    for relative, (supporting, destination) in sorted(inventory_supporting_sources().items()):
        digest.update(destination.encode('utf-8'))
        digest.update(b'\0')
        digest.update(hash_path(supporting).encode('ascii'))
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
        }
    return result


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


def classify_receipt(receipt, malformed, sources, metadata, plugin_version, fingerprint):
    """Classify receipt/projection state before any destination mutation."""
    if not receipt and not malformed:
        return {
            'state': 'new',
            'requires_migration': False,
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
    if isinstance(receipt, dict) and receipt.get('plugin_version') != plugin_version:
        reasons.append(f"receipt plugin version {receipt.get('plugin_version', '<missing>')} differs from source {plugin_version}")
    if isinstance(receipt, dict) and receipt.get('source_fingerprint') != fingerprint:
        reasons.append('receipt source fingerprint differs from the current Codex source')
    return {
        'state': 'stale' if reasons else 'current',
        'requires_migration': requires_migration,
        'reasons': reasons,
        'legacy_names': sorted(set(legacy_names)),
        'retired_names': sorted(set(retired_names)),
    }


def current_sources():
    result = {'skills': {}, 'agents': {}, 'supporting_assets': {}}
    for kind in ('skills', 'agents'):
        root = os.path.join(CODEX_SRC, kind)
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            if is_ignored_distribution_name(name):
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
    source_fp = hash_path(source)
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
        shutil.copytree(source, destination, symlinks=False, ignore=ignore_distribution_entries)
    else:
        shutil.copy2(source, destination)


def install_atomic(source, destination):
    """Stage a fresh destination beside its final path, then publish it.

    The migration path uses this helper so an unchanged legacy destination is
    not removed until the new public-name entry has been materialized. A
    pre-existing destination is never removed here; callers must first prove
    it is receipt-owned and unchanged.
    """
    parent = os.path.dirname(destination)
    os.makedirs(parent, exist_ok=True)
    stage_dir = tempfile.mkdtemp(prefix='.dhpk-install-', dir=parent)
    staged = os.path.join(stage_dir, os.path.basename(destination))
    try:
        if MODE == 'symlink':
            os.symlink(source, staged, target_is_directory=os.path.isdir(source))
        elif os.path.isdir(source):
            shutil.copytree(source, staged, symlinks=False, ignore=ignore_distribution_entries)
        else:
            shutil.copy2(source, staged)
        os.replace(staged, destination)
    finally:
        if lexists(stage_dir):
            shutil.rmtree(stage_dir, ignore_errors=True)


def build_evidence(plugin_version, fingerprint, entries, counts, state):
    destinations = {}
    ownership = dict(evidence_ownership)
    for kind in ('skills', 'agents', 'supporting_assets'):
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
        'source_root': 'codex',
        'destination_root': '.codex',
        'receipt': '.codex/.dhpk-installed.json',
    }
    for kind, values in evidence_paths.items():
        paths[kind] = sorted(set(values))
    return {
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


def save_receipt(plugin_version, fingerprint, entries, orphaned, counts, legacy_pending=False, state=None):
    ensure_manifest_safe()
    os.makedirs(CODEX_ROOT, exist_ok=True)
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
        'installed_at': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z',
        'managed_entries': entries,
        'orphaned_entries': orphaned,
        'reconciliation': durable_counts,
        'state': state,
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
        'created', 'updated', 'migrated', 'preserved', 'skipped_collision', 'collided',
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
                remove_path(old_destination)
                if key != public_name:
                    del entries['skills'][key]
                entries['skills'][public_name] = make_entry(source, new_relative, new_destination, metadata.get(public_name))
                clear_orphaned(relative, new_relative)
                counts['migrated'] += 1
                record_path('migrated', relative)
                record_path('migrated', new_relative)
                record_ownership(new_relative, 'dhpk-managed')
                continue

            # Publish the new destination first. Only after it is visible do we
            # remove the unchanged legacy path, preserving rollback safety.
            install_atomic(source, new_destination)
            backup = backup_destination(relative, old_destination, 'legacy-migration')
            if backup:
                counts['backed_up'] += 1
            remove_path(old_destination)
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


plugin_version = read_plugin_version()
fingerprint = source_fingerprint()
try:
    receipt, legacy = read_receipt()
except ValueError as error:
    print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
    sys.exit(2)
try:
    sources = current_sources()
    skill_metadata = inventory_skill_metadata()
    validate_skill_metadata(sources, skill_metadata)
except ValueError as error:
    print(f'[install-codex-skills] ERROR: {error}', file=sys.stderr)
    sys.exit(2)

classification = classify_receipt(receipt, legacy, sources, skill_metadata, plugin_version, fingerprint)
legacy_pending = bool(
    legacy
    or classification.get('requires_migration')
    or (isinstance(receipt, dict) and receipt.get('legacy_pending'))
)
entries = entry_map(receipt)
orphaned = dict(receipt.get('orphaned_entries') or {}) if isinstance(receipt, dict) else {}
counts = {k: 0 for k in (
    'created', 'updated', 'migrated', 'preserved', 'skipped_collision', 'collided',
    'pruned', 'retired', 'backed_up', 'orphaned',
)}
collisions = []


def clear_orphaned(*relatives):
    for relative in relatives:
        if isinstance(relative, str) and relative:
            orphaned.pop(relative, None)

if classification.get('requires_migration') and not MIGRATE and UNINSTALL is False:
    print('[install-codex-skills] state=stale_receipt: explicit migration is required before changing this projection', file=sys.stderr)
    for reason in classification.get('reasons') or []:
        print(f'[install-codex-skills] stale evidence: {reason}', file=sys.stderr)
    mode_hint = '--copy ' if MODE == 'copy' else ''
    print(
        '[install-codex-skills] ACTION REQUIRED: '
        f'bash scripts/hooks/install-codex-skills.sh {mode_hint}--migrate --update --force',
        file=sys.stderr,
    )
    sys.exit(2)

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

# Public-name migration must run before the generic update-prune pass: an old
# receipt key is not a current source name, but it remains protected when the
# inventory migration cannot prove ownership.
if UPDATE or MIGRATE:
    migrate_legacy_skill_names(entries, orphaned, counts, collisions, sources, skill_metadata)

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
                clear_orphaned(relative)
            elif is_owned(old, destination):
                backup = backup_destination(relative, destination, 'retired-entry')
                if backup:
                    counts['backed_up'] += 1
                remove_path(destination)
                del entries[kind][name]
                counts['pruned'] += 1
                counts['retired'] += 1
                record_path('retired', relative)
                record_ownership(relative, 'dhpk-managed')
            else:
                entries[kind][name] = dict(old, orphaned=True)
                orphaned[relative] = dict(old, reason='modified-removed-source')
                counts['orphaned'] += 1
                record_path('orphaned', relative)
                record_ownership(relative, 'orphaned')

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
                entries[kind][name] = make_entry(source, relative, destination, skill_metadata.get(name) if kind == 'skills' else None)
                adopted = True
                counts['preserved'] += 1
            if adopted:
                clear_orphaned(relative)
                record_path('migrated', relative)
                record_ownership(relative, 'dhpk-managed')
                continue
            if not owned:
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
            install(source, destination)
            entries[kind][name] = make_entry(source, relative, destination, skill_metadata.get(name) if kind == 'skills' else None)
            clear_orphaned(relative)
            counts['updated'] += 1
            record_path('updated', relative)
            record_ownership(relative, 'dhpk-managed')
        else:
            install(source, destination)
            entries[kind][name] = make_entry(source, relative, destination, skill_metadata.get(name) if kind == 'skills' else None)
            clear_orphaned(relative)
            counts['created'] += 1
            record_path('created', relative)
            record_ownership(relative, 'dhpk-managed')

if legacy_pending and MIGRATE and not collisions:
    legacy_pending = False
reconciliation_state = 'stale' if legacy_pending else ('partial' if collisions or orphaned else 'current')
save_receipt(
    plugin_version,
    fingerprint,
    entries,
    orphaned,
    counts,
    legacy_pending=legacy_pending,
    state=reconciliation_state,
)
counts['collided'] = counts.get('skipped_collision', 0)
counts['backed_up'] = counts.get('backed_up', 0)
print_summary(counts, collisions, sorted(orphaned))
print(f'[install-codex-skills] synced dhpk v{plugin_version} codex/ → project-local .codex/ (mode={MODE})')
PY
