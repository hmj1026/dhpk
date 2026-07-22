#!/usr/bin/env bash
# Source-only. Session install-health: version freshness computed from purely
# local plugin state.
#
# Contract (see openspec specs/session-install-health):
#   - No network calls. Ever. Freshness is judged from what the machine already
#     knows, so the result is identical offline.
#   - Every read degrades silently to a no-op when absent, unreadable, or
#     unparseable. A hostile or missing home directory cannot break session start.
#   - Never blocks; callers always exit 0.
#
# Resolution chain for the available version:
#   installed_plugins.json  -> installed version of dhpk@dhpk
#   known_marketplaces.json -> the dhpk marketplace's installLocation + source
#   <installLocation>/.claude-plugin/marketplace.json
#                           -> the plugins[] entry whose NAME is dhpk
#   <entry.source resolved against installLocation>/.claude-plugin/plugin.json
#                           -> available version
# The entry is selected by name, never by "whatever manifest a marketplace
# happens to contain" — a marketplace commonly lists many plugins.

# Self-contained: a caller sourcing only this file gets a working gate.
# Re-sourcing in session-start.sh (which already sources both) is harmless.
. "${BASH_SOURCE[0]%/*}/advise-once.sh"
. "${BASH_SOURCE[0]%/*}/detect-stack-hints.sh"

DHPK_PLUGINS_DIR="${DHPK_PLUGINS_DIR:-$HOME/.claude/plugins}"
DHPK_PLUGIN_KEY="${DHPK_PLUGIN_KEY:-dhpk@dhpk}"
DHPK_PLUGIN_NAME="${DHPK_PLUGIN_NAME:-dhpk}"

# dhpk_version_state — prints one line of key=value pairs, or nothing at all
# when the state cannot be resolved:
#   installed=<v> available=<v> gap=<none|patch|minor|major|ahead>
#   ask=<0|1> source=<github|directory|...> age_days=<n>
#
# `ask` reflects only whether the version gap itself warrants a question
# (design D6: minor or major, never patch; design D4: never for a
# directory-source marketplace). Project-level pin policy is applied by
# dhpk_version_message, not here.
dhpk_version_state() {
    command -v python3 >/dev/null 2>&1 || return 0
    [ -d "$DHPK_PLUGINS_DIR" ] || return 0

    DHPK_PLUGINS_DIR="$DHPK_PLUGINS_DIR" \
    DHPK_PLUGIN_KEY="$DHPK_PLUGIN_KEY" \
    DHPK_PLUGIN_NAME="$DHPK_PLUGIN_NAME" \
    python3 <<'PY' 2>/dev/null || return 0
import json, os, sys
from datetime import datetime, timezone

root = os.environ["DHPK_PLUGINS_DIR"]
key = os.environ["DHPK_PLUGIN_KEY"]
name = os.environ["DHPK_PLUGIN_NAME"]


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def bail():
    sys.exit(0)


try:
    installed_state = load(os.path.join(root, "installed_plugins.json"))
    marketplaces = load(os.path.join(root, "known_marketplaces.json"))
except Exception:
    bail()

records = (installed_state.get("plugins") or {}).get(key)
if not isinstance(records, list) or not records:
    bail()
installed = (records[0] or {}).get("version") or ""
if not installed or installed == "unknown":
    bail()

# The marketplace is the part of the key after "@"; fall back to the plugin name.
marketplace_name = key.split("@", 1)[1] if "@" in key else name
entry = marketplaces.get(marketplace_name)
if not isinstance(entry, dict):
    bail()

source = ((entry.get("source") or {}).get("source")) or "unknown"
location = entry.get("installLocation") or ""
if not location:
    bail()

try:
    catalog = load(os.path.join(location, ".claude-plugin", "marketplace.json"))
except Exception:
    bail()

# Select by NAME. A marketplace commonly lists many plugins.
plugin_entry = None
for candidate in catalog.get("plugins") or []:
    if isinstance(candidate, dict) and candidate.get("name") == name:
        plugin_entry = candidate
        break
if plugin_entry is None:
    bail()

src = plugin_entry.get("source")
if isinstance(src, dict):
    rel = src.get("path") or "./"
elif isinstance(src, str):
    rel = src
else:
    rel = "./"

try:
    plugin_dir = os.path.normpath(os.path.join(location, rel))
    available = load(os.path.join(plugin_dir, ".claude-plugin", "plugin.json")).get("version") or ""
except Exception:
    bail()
if not available:
    bail()


def parts(v):
    out = []
    for chunk in str(v).split("-")[0].split(".")[:3]:
        try:
            out.append(int(chunk))
        except ValueError:
            out.append(0)
    while len(out) < 3:
        out.append(0)
    return out


a, b = parts(installed), parts(available)
if a == b:
    gap = "none"
elif a > b:
    gap = "ahead"
elif a[0] != b[0]:
    gap = "major"
elif a[1] != b[1]:
    gap = "minor"
else:
    gap = "patch"

# D4: a directory-source marketplace's "available version" is a live working
# tree that moves with development. Never a question.
ask = 1 if (gap in ("minor", "major") and source != "directory") else 0

age_days = -1
stamp = entry.get("lastUpdated")
if stamp:
    try:
        parsed = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        age_days = max(0, int((datetime.now(timezone.utc) - parsed).total_seconds() // 86400))
    except Exception:
        age_days = -1

print(
    "installed=%s available=%s gap=%s ask=%d source=%s age_days=%d"
    % (installed, available, gap, ask, source, age_days)
)
PY
}

# dhpk__version_field <state-line> <key> — pull one value out of a state line.
dhpk__version_field() {
    printf '%s\n' "$1" | tr ' ' '\n' | while IFS='=' read -r k v; do
        [ "$k" = "$2" ] && printf '%s' "$v"
    done
}

# dhpk__fetch_age_phrase <age_days> — always an age, never a bare currency claim.
dhpk__fetch_age_phrase() {
    case "$1" in
        -1) printf 'at an unknown time' ;;
        0)  printf 'less than a day ago' ;;
        1)  printf '1 day ago' ;;
        *)  printf '%s days ago' "$1" ;;
    esac
}

# dhpk__pin_ranges <project-root> — prints the pin file's verified range
# prefixes, one per line. Prints nothing when there is no pin file.
dhpk__pin_ranges() {
    local pin="$1/.claude/dhpk-versions.json"
    [ -f "$pin" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0
    python3 - "$pin" <<'PY' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        pins = json.load(f)
except Exception:
    sys.exit(0)
for item in pins.get("verified") or []:
    rng = (item.get("range") or "").strip().replace(".x", "").rstrip(".")
    if rng:
        print(rng)
PY
}

dhpk__version_covered() {
    local version="$1" prefix
    shift
    while IFS= read -r prefix; do
        [ -n "$prefix" ] || continue
        [ "$version" = "$prefix" ] && return 0
        case "$version" in "$prefix".*) return 0 ;; esac
    done
    return 1
}

# dhpk_version_message — the human-facing freshness text, or nothing.
#
# Composes the message only; it does not decide when the session shows it. A
# `gap=none` currency line is produced so its phrasing stays under test (design
# D5), while the gate itself only surfaces actionable findings.
#
# Pin-file precedence (design D10). The governing rule is that freshness speaks
# only when the project has expressed NO version policy — keyed on the ABSENCE
# OF A PIN FILE, not on the pin advisory happening to be silent. A pin file
# whose verified range covers the running version produces no advisory, yet the
# project has still expressed a policy; recommending an upgrade it has not
# blessed would push the user into the exact state the next session flags.
# Optional $1: a state line from a prior dhpk_version_state call. Passing it
# avoids a second python3 spawn on the session-start hot path; omitting it
# keeps the function usable on its own.
dhpk_version_message() {
    local root="${CLAUDE_PROJECT_DIR:-$PWD}"
    local line="$1" installed available gap age phrase ranges

    [ -n "$line" ] || line="$(dhpk_version_state)"
    [ -n "$line" ] || return 0

    installed="$(dhpk__version_field "$line" installed)"
    available="$(dhpk__version_field "$line" available)"
    gap="$(dhpk__version_field "$line" gap)"
    age="$(dhpk__version_field "$line" age_days)"
    phrase="$(dhpk__fetch_age_phrase "$age")"

    case "$gap" in
        none)
            printf 'dhpk %s matches the newest version this marketplace knows of, as of its last fetch %s; a newer release may exist upstream.' \
                "$installed" "$phrase"
            return 0 ;;
        ahead)
            # Installed newer than the marketplace: a development state, not
            # staleness. Genuinely nothing to say.
            return 0 ;;
        patch)
            # D6 says patch drift is "reported in the advisory line but does
            # not raise a question", and the spec's "Patch gap is advisory
            # only" scenario requires the drift to APPEAR in the advisory
            # output. Advisory-only means unasked, not unsaid — folding this
            # into the `ahead` branch dropped it entirely.
            printf 'dhpk %s installed; patch release %s available (marketplace last fetched %s). Advisory only — no question raised. Run `claude plugin update dhpk@dhpk` when convenient; a hook cannot run it, and it only takes effect in a fresh session.' \
                "$installed" "$available" "$phrase"
            return 0 ;;
    esac

    ranges="$(dhpk__pin_ranges "$root")"
    if [ -f "$root/.claude/dhpk-versions.json" ]; then
        # A policy exists. Only an already-blessed version may be recommended.
        if printf '%s\n' "$ranges" | dhpk__version_covered "$installed"; then
            if printf '%s\n' "$ranges" | dhpk__version_covered "$available"; then
                printf 'dhpk %s installed; %s available and covered by this project'"'"'s verified ranges (marketplace last fetched %s). Run `claude plugin update dhpk@dhpk` — a hook cannot run it, and it only takes effect in a fresh session. For the full configuration audit, use the claude-health skill.' \
                    "$installed" "$available" "$phrase"
            else
                printf 'dhpk %s installed and %s is available (marketplace last fetched %s), but .claude/dhpk-versions.json does not list %s among this project'"'"'s verified ranges — the upgrade is not recommended until the pin file blesses it. For the full configuration audit, use the claude-health skill.' \
                    "$installed" "$available" "$phrase" "$available"
            fi
        fi
        # Running version outside the verified ranges: check-plugin-version.sh
        # is already speaking about it. One version message per session.
        return 0
    fi

    printf 'dhpk %s installed; %s available (marketplace last fetched %s). Run `claude plugin update dhpk@dhpk` — a hook cannot run it, and it only takes effect in a fresh session. For the full configuration audit, use the claude-health skill.' \
        "$installed" "$available" "$phrase"
}

# dhpk__hash <string> — short stable digest, with fallbacks for machines
# carrying neither sha256sum nor shasum.
dhpk__hash() {
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$1" | sha256sum | cut -c1-16
    elif command -v shasum >/dev/null 2>&1; then
        printf '%s' "$1" | shasum -a 256 | cut -c1-16
    else
        printf '%s' "$1" | cksum | tr -cd '0-9' | cut -c1-16
    fi
}

# dhpk_install_health_report <project-root> <configured-modules>
#
# The gate itself. Prints one block of instruction context, or nothing.
#
# Suppression (design D8) is keyed on OBSERVED STATE — the installed version,
# the available version, and the enabled module set — not on a bare condition
# name. A condition name would mean ask-once-*ever*, swallowing every future
# drift, which is the same silence this gate exists to break. The state digest
# is fed to `dhpk_advise_once` as its session identity, so an unchanged
# dismissed finding never asks twice while any change re-opens it.
#
# This function NEVER writes configuration. It emits text; remediation is the
# user's decision, taken through the model in the ensuing conversation.
# Optional $3: a mismatch string from a prior dhpk_detect_stack_mismatch call.
# session-start.sh already computes it for its stderr WARN line; passing it
# avoids running the whole source census a second time on the hot path. Pass
# the empty string to mean "computed, and there was no mismatch" — only an
# entirely absent third argument triggers a fresh computation.
dhpk_install_health_report() {
    local root="$1" modules="$2"
    local vline installed available gap vask vmsg="" mismatch digest
    local version_news=0 raise_question=0 has_pin=0

    vline="$(dhpk_version_state)"
    installed="$(dhpk__version_field "$vline" installed)"
    available="$(dhpk__version_field "$vline" available)"
    gap="$(dhpk__version_field "$vline" gap)"
    vask="$(dhpk__version_field "$vline" ask)"

    [ -f "$root/.claude/dhpk-versions.json" ] && has_pin=1

    if [ "${3-__DHPK_UNSET__}" = "__DHPK_UNSET__" ]; then
        mismatch="$(dhpk_detect_stack_mismatch "$root" "$modules")"
    else
        mismatch="$3"
    fi

    # Freshness speaks only where the project has expressed no version policy.
    # A pin file means check-plugin-version.sh owns the version conversation.
    if [ "$has_pin" -eq 0 ]; then
        case "$gap" in
            minor|major|patch) version_news=1 ;;
        esac
    fi

    # The gate speaks for a contradicted module set or for actionable version
    # news. A patch gap counts: D6 makes it advisory, not silent.
    [ -n "$mismatch" ] || [ "$version_news" -eq 1 ] || return 0

    # Once the gate is speaking anyway, include the version line even when the
    # gap is `none` — that is the currency claim, and D5 requires any such
    # claim to carry its fetch age. It is never emitted on its own, so a
    # healthy install stays silent rather than being told it is healthy.
    if [ "$has_pin" -eq 0 ]; then
        vmsg="$(CLAUDE_PROJECT_DIR="$root" dhpk_version_message "$vline")"
    fi

    # A question is warranted by a contradicted module set, or by a minor/major
    # version gap. Patch drift and a currency line are advisory only (D6).
    [ -n "$mismatch" ] && raise_question=1
    [ "$vask" = "1" ] && [ "$has_pin" -eq 0 ] && raise_question=1
    [ "${DHPK_INSTALL_HEALTH_ASK:-1}" = "1" ] || raise_question=0

    digest="$(dhpk__hash "${installed}|${available}|${modules}")"
    DHPK_ADVISE_SESSION_ID="$digest" dhpk_advise_once install-health || return 0

    printf '[dhpk install health]\n'
    if [ "$raise_question" -eq 1 ]; then
        printf 'Before starting the work the user asked for, raise exactly ONE AskUserQuestion covering every finding below, then carry out the request in this same turn. Raise a single question for all findings — never one question per finding.\n'
    else
        printf 'Surface the findings below to the user as an advisory. Do not raise a question.\n'
    fi
    printf '\nFindings:\n'
    [ -n "$vmsg" ] && printf -- '- version: %s\n' "$vmsg"
    [ -n "$mismatch" ] && printf -- '- modules: %s — enabled stack modules the project shows no evidence for.\n' "$mismatch"
    printf '\nRemediation (offer it; never apply it unasked):\n'
    if [ -n "$mismatch" ]; then
        printf -- '- modules: write a project-level `modules` override to .claude/settings.local.json ONLY after the user confirms the detected stack. Change no configuration file otherwise.\n'
    fi
    # Only when there is actually a newer version. A currency line carries no
    # upgrade to recommend.
    if [ "$version_news" -eq 1 ]; then
        printf -- '- version: `claude plugin update dhpk@dhpk`. A hook cannot run it, and it only takes effect in a fresh session.\n'
    fi
    printf -- '- For the deep configuration audit, use the claude-health skill rather than re-deriving it here.\n'
}
