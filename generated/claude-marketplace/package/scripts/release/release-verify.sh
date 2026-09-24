#!/usr/bin/env bash
# release-verify.sh --mode tag|dry-run --out-dir DIR [--tag vX.Y.Z] [--version X.Y.Z] [--run-id ID]
#
# Single implementation of the pre-publish release verification. The tag
# Release workflow runs it in `tag` mode; the release-PR `release-rehearsal`
# CI job (and a maintainer, locally) runs it in `dry-run` mode, so the paths
# that used to execute only after an immutable tag existed are exercised
# before merge. See docs/adr/0021-three-proof-release-model.md (addendum).
#
# Stages (both modes, in order): parity, preflight, packages, manifest,
# notes, bundle, verifier-digest.
#   tag mode adds `provenance` first (tag shape + contained in origin/main).
#   dry-run adds `standalone-verify` last: the downloaded-verifier check the
#   no-checkout publish job performs, run from a directory outside the
#   checkout. Dry-run never tags, publishes, or needs write permission.
#
# Writes into DIR (names match the release.yml upload steps):
#   dhpk-release-notes.txt, dhpk-release-artifact-manifest.json,
#   dhpk-release-publication-bundle.json,
#   dhpk-release-publication-notes-digest.json
# Emits target_commit, target_tree, notes_sha256 and verifier_sha256 to
# $GITHUB_OUTPUT when set. The full test suite is NOT run here: the tag
# workflow runs it as its own step and the release PR's validate job already
# ran it on the same tree.
set -euo pipefail

usage() {
    echo "usage: release-verify.sh --mode tag|dry-run --out-dir DIR [--tag vX.Y.Z] [--version X.Y.Z] [--run-id ID]" >&2
    exit 2
}

mode=""
out_dir=""
tag=""
version=""
run_id="${GITHUB_RUN_ID:-}"
while [ "$#" -gt 0 ]; do
    case "$1" in
        --mode) mode="${2:-}"; shift 2 ;;
        --out-dir) out_dir="${2:-}"; shift 2 ;;
        --tag) tag="${2:-}"; shift 2 ;;
        --version) version="${2:-}"; shift 2 ;;
        --run-id) run_id="${2:-}"; shift 2 ;;
        *) echo "release-verify: unknown argument '$1'" >&2; usage ;;
    esac
done

case "$mode" in
    tag|dry-run) ;;
    *) echo "release-verify: --mode must be tag or dry-run" >&2; usage ;;
esac
[ -n "$out_dir" ] || { echo "release-verify: --out-dir is required" >&2; usage; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

if [ "$mode" = "tag" ]; then
    [ -n "$tag" ] || { echo "release-verify: tag mode requires --tag" >&2; usage; }
    if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "release-verify: tag must match vX.Y.Z (got '$tag')" >&2
        exit 1
    fi
    if [ -n "$version" ] && [ "$version" != "${tag#v}" ]; then
        echo "release-verify: --version $version does not match tag $tag" >&2
        exit 1
    fi
    version="${tag#v}"
else
    if [ -z "$version" ]; then
        version="$(node -e 'process.stdout.write(require(process.argv[1]).version || "")' "$root/.claude-plugin/plugin.json")"
    fi
    if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "release-verify: version must match X.Y.Z (got '$version')" >&2
        exit 1
    fi
    if [ -n "$tag" ] && [ "$tag" != "v$version" ]; then
        echo "release-verify: --tag $tag does not match version $version" >&2
        exit 1
    fi
    tag="v$version"
    [ -n "$run_id" ] || run_id="local-$(date +%s)"
fi
[ -n "$run_id" ] || { echo "release-verify: tag mode requires --run-id or GITHUB_RUN_ID" >&2; exit 2; }

mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"
notes_file="$out_dir/dhpk-release-notes.txt"
manifest_file="$out_dir/dhpk-release-artifact-manifest.json"
bundle_file="$out_dir/dhpk-release-publication-bundle.json"
digest_file="$out_dir/dhpk-release-publication-notes-digest.json"
verifier="scripts/release/verify-publication-bundle.js"

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

emit_output() {
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "$1=$2" >> "$GITHUB_OUTPUT"
    fi
}

current_stage=""
stage() {
    [ -n "$current_stage" ] && echo "::endgroup::"
    current_stage="$1"
    echo "::group::release-verify [$mode] $1"
}
trap 'status=$?; if [ "$status" -ne 0 ] && [ -n "$current_stage" ]; then echo "::endgroup::"; echo "::error::release-verify [$mode] stage $current_stage failed" >&2; fi' EXIT

if [ "$mode" = "tag" ]; then
    stage provenance
    target_commit="$(git rev-list -n 1 "$tag")"
    if ! git merge-base --is-ancestor "$target_commit" origin/main; then
        echo "release-verify: tag commit is not contained in origin/main" >&2
        exit 1
    fi
else
    target_commit="$(git rev-parse HEAD)"
fi
target_tree="$(git rev-parse "${target_commit}^{tree}")"
emit_output target_commit "$target_commit"
emit_output target_tree "$target_tree"

stage parity
node scripts/ci/verify-release-parity.js --version "$version"

stage preflight
set +e
preflight_output="$(bin/dhpk harness preflight --json)"
preflight_exit="$?"
set -e
echo "$preflight_output"
preflight_outcome="$(node -e 'console.log(JSON.parse(process.argv[1]).outcome || "")' "$preflight_output")"
case "$preflight_outcome" in
    PASS)
        [ "$preflight_exit" -eq 0 ] || exit 1
        ;;
    UNAVAILABLE)
        [ "$preflight_exit" -eq 2 ] || exit 1
        echo "Harness facade preflight is UNAVAILABLE on standard runner; keeping it non-blocking."
        ;;
    BLOCKED|FAIL)
        echo "::error::Harness facade preflight outcome is $preflight_outcome" >&2
        exit 1
        ;;
    *)
        echo "::error::Unexpected harness facade preflight outcome: $preflight_outcome" >&2
        exit 1
        ;;
esac

stage packages
for surface in agent-plugin cursor-plugin codex-native agy-plugin; do
    bin/dhpk distribution "$surface" validate --json
done
node scripts/ci/verify-platform-packages.js

# Bind the exact tracked package bytes that passed the package gate to this
# run; consumer verification checks this manifest against the target before
# any probe and never treats a generic cache hit as evidence.
stage manifest
node scripts/release/release-artifact-manifest.js \
    --output "$manifest_file" \
    --run-id "$run_id" \
    --version "$version"

stage notes
bash scripts/release/extract-notes.sh CHANGELOG.md "$version" > "$notes_file"
notes_sha256="sha256:$(sha256_of "$notes_file")"
emit_output notes_sha256 "$notes_sha256"

stage bundle
node scripts/release/release-publication-bundle.js \
    --output "$bundle_file" \
    --notes-file "$notes_file" \
    --run-id "$run_id" \
    --tag "$tag" \
    --version "$version" \
    --expected-notes-sha256 "$notes_sha256" \
    --digest-output "$digest_file" \
    --target-commit "$target_commit" \
    --target-tree "$target_tree"

stage verifier-digest
verifier_sha256="sha256:$(sha256_of "$verifier")"
emit_output verifier_sha256 "$verifier_sha256"

if [ "$mode" = "dry-run" ]; then
    # Reproduce the no-checkout publish consumer: copy the verifier out of the
    # repository, check its digest binding, and run it from that directory.
    stage standalone-verify
    consumer_dir="$(mktemp -d "${TMPDIR:-/tmp}/dhpk-release-rehearsal.XXXXXX")"
    cp "$verifier" "$consumer_dir/verify-publication-bundle.js"
    if [ "sha256:$(sha256_of "$consumer_dir/verify-publication-bundle.js")" != "$verifier_sha256" ]; then
        echo "release-verify: copied verifier digest does not match the producer binding" >&2
        exit 1
    fi
    (
        cd "$consumer_dir"
        node ./verify-publication-bundle.js \
            --bundle "$bundle_file" \
            --expected-run-id "$run_id" \
            --expected-tag "$tag" \
            --expected-version "$version" \
            --expected-notes-sha256 "$notes_sha256" \
            --expected-notes-digest-file "$digest_file" \
            --expected-target-commit "$target_commit" \
            --expected-target-tree "$target_tree" \
            --notes-output "$consumer_dir/validated-notes.txt"
    )
    if ! cmp -s "$notes_file" "$consumer_dir/validated-notes.txt"; then
        echo "release-verify: validated note bytes differ from the extracted notes" >&2
        exit 1
    fi
    rm -rf "$consumer_dir"
fi

echo "::endgroup::"
current_stage=""
echo "release-verify: $mode PASS (version $version, tag $tag, target $target_commit)"
