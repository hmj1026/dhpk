#!/usr/bin/env bash
# stop-advisory-dispatch.sh — single async Stop dispatcher folding three formerly
# separate default-off advisory hooks (completion-evidence, graduation-scan, and
# the module Stop dispatcher) into ONE hooks.json wiring entry. Each advisory keeps
# its OWN independent enable-gate — evaluated inside its block — so only enabled
# advisories emit. The Stop payload is read once and piped to each block's stdin.
# Advisory only: always exits 0, never blocks Stop.
set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
_advisory_payload="$(dhpk_read_payload)"

# --- Advisory 1: completion-evidence (gate: completion_evidence_enabled) ---
printf '%s' "$_advisory_payload" | (
    # the completion-evidence advisory — Stop hook (advisory only, opt-in).
    #
    # Detects when the assistant claims completion ("done" / "fixed" / "已完成")
    # in this session while the working tree shows source-code changes with NO
    # matching test changes — and prints a stderr warning. Advisory only (exit 0);
    # it never blocks Stop, and it does NOT replace the reviewer chain or /verify.
    #
    # Design:
    # - stdin payload → transcript_path → scan the last N assistant messages
    # - completion-claim keyword match (English + Traditional Chinese)
    # - if any review sentinel is active, stop-review-reminder.sh already owns the
    #   warning — skip to avoid double output
    # - compare `git diff --name-only HEAD`: code changes without test changes →
    #   warn; doc-only / .claude/ / openspec/ changes are exempt (no test needed)
    #
    # Opt-in: userConfig.completion_evidence_enabled (default false).
    # One-shot override: DHPK_COMPLETION_EVIDENCE=1/0.
    # Cost: transcript JSONL tail + one git diff, <200ms.

    . "$(dirname "$0")/_lib/session-env.sh"
    . "$(dirname "$0")/_lib/payload.sh"
    . "$(dirname "$0")/_lib/transcript.sh"
    . "$(dirname "$0")/_lib/json-out.sh"

    ROOT="$(dhpk_root)"
    . "$(dirname "$0")/_lib/load-project-config.sh" 2>/dev/null || true

    # Opt-in gate (env override > userConfig > default off).
    _enabled="$(dhpk_config_bool completion_evidence_enabled false DHPK_COMPLETION_EVIDENCE)"
    [ "$_enabled" = "true" ] || exit 0

    # minimal profile suppresses all advisory output.
    PROFILE="$(dhpk_config_profile)"
    [ "$PROFILE" = "minimal" ] && exit 0

    SESS="$(dhpk_sessions_dir "$ROOT")"
    PAYLOAD="$(dhpk_read_payload)"

    # transcript path extraction lives in _lib/transcript.sh (shared with
    # the graduation-scan advisory).
    TRANSCRIPT="$(extract_transcript_path "$PAYLOAD")"
    [ -z "$TRANSCRIPT" ] && exit 0
    [ -f "$TRANSCRIPT" ] || exit 0

    # Active sentinels → stop-review-reminder.sh already owns the reminder.
    for name in "${SENTINEL_NAMES[@]}"; do
        if [ -f "$SESS/$name" ]; then
            exit 0
        fi
    done

    # Grab the text of the last N transcript lines' assistant messages.
    TAIL_LINES=80
    recent_assistant_text=""
    if command -v jq >/dev/null 2>&1; then
        recent_assistant_text="$(tail -n "$TAIL_LINES" "$TRANSCRIPT" 2>/dev/null | jq -r '
            select(.role == "assistant" or .type == "assistant")
            | (.content // .message.content // [])
            | if type == "array"
              then map(if type == "object" and .type == "text" then .text else (. | tostring) end) | join("\n")
              else (. | tostring)
              end
        ' 2>/dev/null | tr '\n' ' ' | tr -s ' ' || true)"
    fi
    # Fallback: raw tail (jq missing or parse failed).
    if [ -z "$recent_assistant_text" ]; then
        recent_assistant_text="$(tail -n "$TAIL_LINES" "$TRANSCRIPT" 2>/dev/null | tr '\n' ' ' || true)"
    fi

    # Completion-claim keywords (English + Traditional Chinese). Word boundaries
    # via trailing space/period so "donate" / "donor" don't trip "done".
    claim_pattern='(已完成|已修[復正完]|完成了|完成。|completed[[:space:]\.]|implemented[[:space:]\.]|all done|task done|done[[:space:]\.]|step.*complete|fix(ed)?[[:space:]\.]|shipped[[:space:]\.])'
    if ! printf '%s' "$recent_assistant_text" | grep -qiE "$claim_pattern"; then
        exit 0
    fi

    # Compare against git diff (HEAD vs working tree, staged + unstaged) PLUS
    # untracked-but-not-ignored files, so a brand-new test file (e.g. an untracked
    # *.spec.js added by a TDD flow) counts as test evidence instead of being
    # invisible. The two sets are disjoint (tracked/staged vs untracked), so
    # concatenating them cannot double-count; --exclude-standard honors .gitignore.
    diff_files="$(cd "$ROOT" && { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } || true)"
    [ -z "$diff_files" ] && exit 0

    # Classify code vs test. The exclude regex groups (^|/)tests?/ explicitly so
    # root-level *Test.php files don't slip past the alternation.
    code_files="$(printf '%s\n' "$diff_files" | grep -E '\.(php|js|ts|jsx|tsx|py|rb|go|rs|java|kt|swift)$' | grep -vE '(Test\.php$|\.test\.(js|ts|jsx|tsx)$|\.spec\.(js|ts|jsx|tsx)$|_test\.(py|go)$|(^|/)tests?/|/__tests__/|(^|/)spec/)' || true)"
    test_files="$(printf '%s\n' "$diff_files" | grep -E '(Test\.php$|\.test\.(js|ts|jsx|tsx)$|\.spec\.(js|ts|jsx|tsx)$|_test\.(py|go)$|(^|/)tests?/|/__tests__/|(^|/)spec/)' || true)"

    # No code change (doc-only / harness / spec edits) → no test evidence needed.
    [ -z "$code_files" ] && exit 0

    # Code change with test change → evidence present.
    [ -n "$test_files" ] && exit 0

    # Code change + completion claim + zero test changes → warn.
    code_count="$(printf '%s' "$code_files" | grep -c . 2>/dev/null || echo 0)"
    sample="$(printf '%s\n' "$code_files" | head -3 | sed 's/^/    - /')"
    extra=""
    [ "$code_count" -gt 3 ] && extra="    ... and $((code_count - 3)) more file(s)"

    msg="[completion-evidence] COMPLETION CLAIM without test evidence.
The assistant claimed completion, but git diff shows $code_count code file(s) changed with no test changes:
$sample"
    [ -n "$extra" ] && msg="$msg
$extra"
    msg="$msg

If this was a refactor / dead-code removal / doc-only path, ignore this.
Otherwise: add a failing-first test (tdd-guide) or run /verify."

    # Advisory only — never block Stop. systemMessage so the user decides (exit-0
    # stderr is inert; see _lib/json-out.sh).
    emit_system_message "$msg"
    exit 0
)

# --- Advisory 2: graduation-scan (gate: graduation_scan_enabled) ---
printf '%s' "$_advisory_payload" | (
    # the graduation-scan advisory — Stop hook (advisory only, knowledge graduation).
    #
    # Scans the session transcript for cited auto-memory entries
    # (~/.claude/projects/<slug>/memory/<entry>.md), maintains a cross-session
    # count + confidence score per entry, and regenerates a graduation-candidates
    # report proposing which entries are stable enough to promote into a real rule
    # or skill. Ported and generalised from zdpos_dev's local hook (Phase 2.2 of
    # the vexjoy-agent comparison plan).
    #
    # Why this exists
    # ---------------
    # Auto-memory accumulates fast. Manual promotion is easy to forget. This hook
    # automatically surfaces "high-frequency, repeatedly-useful" entries (cited in
    # many sessions without a follow-up trap re-occurrence) as graduation
    # candidates so a human / `dhpk:rules-distill` can promote them deliberately.
    #
    # Design
    # ------
    # - Opt-in: no-op unless graduation_scan_enabled=true
    #   (CLAUDE_PLUGIN_OPTION_GRADUATION_SCAN_ENABLED) or DHPK_GRADUATION_SCAN=1.
    #   Default OFF → zero behaviour change for existing projects.
    # - SSOT: .claude/artifacts/memory-usage-counts.json (cross-session state).
    # - Report: .claude/artifacts/graduation-candidates.md (AUTO-GENERATED region).
    #   Bootstrapped from templates/graduation-candidates.md on first enabled run
    #   if the consumer has no file yet (a plugin can't assume the user scaffolded
    #   it — unlike the zdpos local origin, which required a committed template).
    # - Phase A: cumulative reference count ≥ 3 → candidate.
    # - Phase B confidence (start 0.5, clamp [0,1]):
    #     clean session → +0.1 ; trap re-occurrence near a reference → −0.2.
    # - Time-span gate: promotion to rule/skill also requires the entry to have
    #   been seen across ≥24h and ≥3 distinct dates (blocks same-day 3× graduation).
    # - suggested_target: rule (≥0.7) / skill (0.2–0.7) / decay (≤0.2) / orphan
    #   (source memory file gone — decays then tombstones).
    # - python3 required (JSON state + text analysis); absent → silent skip.
    # - Always exits 0; advisory only.
    #
    # Trigger: Stop event (wired in hooks/hooks.json after stop-review-reminder).
    # Cost: full transcript read + 1 python3 pass, <500ms (large sessions more).

    PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
    . "$(dirname "$0")/_lib/load-project-config.sh"
    . "$(dirname "$0")/_lib/transcript.sh"

    # --- enablement (opt-in) ---------------------------------------------------
    _enabled="$(dhpk_config_bool graduation_scan_enabled false DHPK_GRADUATION_SCAN)"
    [ "$_enabled" = "true" ] || exit 0

    PROFILE="$(dhpk_config_profile)"
    [ "$PROFILE" = "minimal" ] && exit 0

    . "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
    ROOT="$(dhpk_root)"
    COUNTS_JSON="$ROOT/.claude/artifacts/memory-usage-counts.json"
    CANDIDATES_MD="$ROOT/.claude/artifacts/graduation-candidates.md"
    TEMPLATE="$PLUGIN_ROOT/templates/graduation-candidates.md"

    # === Test-mode isolation ===
    # CLAUDE_HOOK_TEST_MODE=1 redirects all state into $CLAUDE_HOOK_TEST_OUTDIR so
    # smoke tests never write into the real .claude/artifacts/ tree.
    if [ "${CLAUDE_HOOK_TEST_MODE:-0}" = "1" ]; then
        TEST_OUT="${CLAUDE_HOOK_TEST_OUTDIR:-${TMPDIR:-/tmp}/dhpk-graduation-test}"
        mkdir -p "$TEST_OUT" 2>/dev/null || true
        COUNTS_JSON="$TEST_OUT/memory-usage-counts.json"
        CANDIDATES_MD="$TEST_OUT/graduation-candidates.md"
    fi

    PAYLOAD="$(dhpk_read_payload)"

    # transcript path extraction lives in _lib/transcript.sh (shared with
    # the completion-evidence advisory).
    TRANSCRIPT="$(extract_transcript_path "$PAYLOAD")"
    [ -z "$TRANSCRIPT" ] && exit 0
    [ -f "$TRANSCRIPT" ] || exit 0

    command -v python3 >/dev/null 2>&1 || exit 0

    mkdir -p "$(dirname "$COUNTS_JSON")" 2>/dev/null || true

    # Bootstrap the candidates report from the shipped template when the consumer
    # has none yet (the python pass only rewrites the AUTO-GENERATED region of an
    # existing file — it never creates the header).
    if [ ! -f "$CANDIDATES_MD" ] && [ -f "$TEMPLATE" ]; then
        cp "$TEMPLATE" "$CANDIDATES_MD" 2>/dev/null || true
    fi

    # === Main logic: scan transcript + maintain counts.json + regenerate md ===
    # Guard the python pass with a 10s timeout where coreutils `timeout` exists
    # (Linux/WSL); macOS lacks it by default — run unguarded there rather than fail.
    TIMEOUT_CMD=""
    command -v timeout >/dev/null 2>&1 && TIMEOUT_CMD="timeout 10"
    TRANSCRIPT="$TRANSCRIPT" \
    COUNTS_JSON="$COUNTS_JSON" \
    CANDIDATES_MD="$CANDIDATES_MD" \
    HOOK_REPO_ROOT="$ROOT" \
    $TIMEOUT_CMD python3 <<'PY' || true
import json, os, re, sys, datetime, pathlib

transcript_path = os.environ["TRANSCRIPT"]
counts_path = os.environ["COUNTS_JSON"]
candidates_path = os.environ["CANDIDATES_MD"]

# repo_root is passed from the bash wrapper (cannot be reverse-derived from
# counts_path: test mode redirects it to $TMPDIR).
repo_root = os.environ.get("HOOK_REPO_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(counts_path)))

def compute_claude_memory_slug(rr: str) -> str:
    """Mirror Claude Code's project-dir naming: '/' → '-', '_' → '-',
    keep leading dash. e.g. /home/u/projects/foo_bar -> -home-u-projects-foo-bar"""
    return str(pathlib.Path(rr).resolve()).replace("/", "-").replace("_", "-")

# memory_dir resolution — env override (CLAUDE_HOOK_MEMORY_DIR) wins so tests
# can isolate without touching the real ~/.claude tree; otherwise the standard
# auto-memory location for this project.
_mem_override = os.environ.get("CLAUDE_HOOK_MEMORY_DIR")
if _mem_override:
    memory_dir = pathlib.Path(_mem_override)
else:
    memory_dir = pathlib.Path.home() / ".claude" / "projects" / compute_claude_memory_slug(repo_root) / "memory"

def memory_entry_exists(entry: str) -> bool:
    return (memory_dir / f"{entry}.md").is_file()

# === Time-span gate ===
MIN_SPAN_HOURS = int(os.environ.get("CLAUDE_HOOK_MIN_SPAN_HOURS", "24"))
MIN_DISTINCT_DATES = int(os.environ.get("CLAUDE_HOOK_MIN_DISTINCT_DATES", "3"))

def passes_time_gate(rec):
    fs, ls = rec.get("first_seen"), rec.get("last_seen")
    if not fs or not ls:
        return False
    try:
        d_fs = datetime.datetime.fromisoformat(fs)
        d_ls = datetime.datetime.fromisoformat(ls)
    except ValueError:
        return False
    if (d_ls - d_fs).total_seconds() < MIN_SPAN_HOURS * 3600:
        return False
    sd = rec.get("seen_dates") or [fs[:10], ls[:10]]
    return len(set(sd)) >= MIN_DISTINCT_DATES

# === Load existing counts ===
state = {"schema_version": 2, "updated_at": "", "entries": {}}
try:
    with open(counts_path, "r", encoding="utf-8") as f:
        loaded = json.load(f)
        if isinstance(loaded, dict) and isinstance(loaded.get("entries"), dict):
            state = loaded
            state.setdefault("schema_version", 1)
            state.setdefault("entries", {})
except (FileNotFoundError, json.JSONDecodeError, ValueError):
    pass

# === Schema v1 → v2 migration: synthesize seen_dates from first/last_seen ===
if state.get("schema_version", 1) < 2:
    for _e, _r in state["entries"].items():
        _dates = {(_r.get("first_seen") or "")[:10], (_r.get("last_seen") or "")[:10]}
        _dates.discard("")
        _r.setdefault("seen_dates", sorted(_dates))
    state["schema_version"] = 2

# === Read transcript ===
try:
    with open(transcript_path, "r", encoding="utf-8", errors="replace") as f:
        transcript_text = f.read()
except OSError:
    sys.exit(0)

# === Extract memory entry references ===
pattern = re.compile(r"memory/([a-z0-9][a-z0-9_-]*)\.md", re.IGNORECASE)
matches = pattern.findall(transcript_text)
seen_this_session = {}
for name in matches:
    key = name.lower()
    seen_this_session[key] = seen_this_session.get(key, 0) + 1

# Filter noise: MEMORY (uppercase index) + very short names (< 4 chars)
filtered = {k: v for k, v in seen_this_session.items()
            if k not in ("memory",) and len(k) >= 4}

# === Phase B trap re-occurrence heuristic ===
RE_OCCUR_SIGNAL = re.compile(
    r"[踩又再](?!到頂|到底).{0,30}(trap|bug|錯|錯誤|fail|regression|崩|壞|錯掉|噴|warning)",
    re.IGNORECASE,
)
WEAK_SIGNAL = re.compile(
    r"(?:又|再|還是|仍).{0,5}(?:踩(?!到頂|到底)|錯|fail)",
    re.IGNORECASE,
)

transcript_lines = transcript_text.splitlines()

WINDOW_BASE = 20
WINDOW = max(5, min(WINDOW_BASE, len(transcript_lines) // 4 or WINDOW_BASE))

def is_trap_reoccurred(entry_name, lines):
    boundary_re = re.compile(r"\b" + re.escape(entry_name) + r"\b", re.IGNORECASE)
    refs = [i for i, line in enumerate(lines) if boundary_re.search(line)]
    if not refs:
        return False
    for ref_idx in refs:
        lo = max(0, ref_idx - WINDOW)
        hi = min(len(lines), ref_idx + WINDOW)
        window = "\n".join(lines[lo:hi])
        if RE_OCCUR_SIGNAL.search(window) or WEAK_SIGNAL.search(window):
            return True
    return False

# === Update state ===
now_iso = datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()
today_date = now_iso[:10]

# === Reconciliation prune: orphan entries decay then tombstone ===
PRUNE_DECAY = 0.3
for _entry, _rec in list(state["entries"].items()):
    if not memory_entry_exists(_entry):
        _rec["orphan"] = True
        _rec["confidence"] = round(max(0.0, float(_rec.get("confidence", 0.5)) - PRUNE_DECAY), 2)
        if _rec.get("confidence", 0) <= 0.0:
            _rec["count"] = max(0, int(_rec.get("count", 0)) - 1)
        if _rec.get("count", 0) <= 0:
            del state["entries"][_entry]
    else:
        _rec.pop("orphan", None)

for entry, hit_count in filtered.items():
    if not memory_entry_exists(entry):
        continue
    rec = state["entries"].get(entry, {
        "count": 0,
        "first_seen": now_iso,
        "last_seen": now_iso,
        "confidence": 0.5,
        "decay_warning": False,
        "seen_dates": [],
    })
    rec["count"] = int(rec.get("count", 0)) + 1  # one session counts once
    rec["last_seen"] = now_iso
    rec.setdefault("first_seen", now_iso)

    sd = rec.setdefault("seen_dates", [])
    if today_date not in sd:
        sd.append(today_date)

    cur = float(rec.get("confidence", 0.5))
    if is_trap_reoccurred(entry, transcript_lines):
        cur = max(0.0, cur - 0.2)
    else:
        cur = min(1.0, cur + 0.1)
    rec["confidence"] = round(cur, 2)
    rec["decay_warning"] = (rec["confidence"] <= 0.2)

    state["entries"][entry] = rec

state["updated_at"] = now_iso

# === Write counts.json atomically ===
tmp = counts_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(state, f, ensure_ascii=False, indent=2, sort_keys=True)
os.replace(tmp, counts_path)

# === Regenerate AUTO-GENERATED region in candidates.md ===
def suggested_target(entry, rec):
    if rec.get("orphan") or not memory_entry_exists(entry):
        return "orphan"
    if rec["count"] < 3:
        return None
    if rec["confidence"] <= 0.2:
        return "decay"
    if not passes_time_gate(rec):
        return None
    if rec["confidence"] >= 0.7:
        return "rule"
    return "skill"

active_rows = []
decay_rows = []
orphan_rows = []
for entry, rec in sorted(state["entries"].items(),
                         key=lambda kv: (-kv[1].get("count", 0), -kv[1].get("confidence", 0))):
    target = suggested_target(entry, rec)
    if target == "orphan":
        orphan_rows.append((entry, rec))
    elif target == "decay":
        decay_rows.append((entry, rec))
    elif target in ("rule", "skill"):
        active_rows.append((entry, rec, target))

def fmt_iso(s):
    return (s or "")[:10]

def build_active_section():
    if not active_rows:
        return "## Active Candidates\n\n(No candidates yet — accrue 3+ cross-session references)\n"
    out = ["## Active Candidates", ""]
    out.append("| Entry | Count | First Seen | Last Seen | Confidence | Suggested Target |")
    out.append("|---|---|---|---|---|---|")
    for entry, rec, target in active_rows:
        out.append(
            f"| {entry} | {rec['count']} | {fmt_iso(rec.get('first_seen'))} | "
            f"{fmt_iso(rec.get('last_seen'))} | {rec['confidence']:.2f} | {target} |"
        )
    out.append("")
    return "\n".join(out)

def build_decay_section():
    if not decay_rows:
        return "## Decay Warnings\n\n(None)\n"
    out = ["## Decay Warnings", ""]
    out.append("| Entry | Count | Last Seen | Confidence |")
    out.append("|---|---|---|---|")
    for entry, rec in decay_rows:
        out.append(
            f"| {entry} | {rec['count']} | {fmt_iso(rec.get('last_seen'))} | "
            f"{rec['confidence']:.2f} |"
        )
    out.append("")
    return "\n".join(out)

def build_orphan_section():
    if not orphan_rows:
        return "## Orphan Entries\n\n(None)\n"
    out = ["## Orphan Entries",
           "",
           "Source memory file missing — renamed / deleted / never written (e.g. smoke-test residue).",
           "Confidence −0.3 per round, then count −1, finally tombstoned.",
           ""]
    out.append("| Entry | Count | Last Seen | Confidence |")
    out.append("|---|---|---|---|")
    for entry, rec in orphan_rows:
        out.append(
            f"| {entry} | {rec['count']} | {fmt_iso(rec.get('last_seen'))} | "
            f"{rec['confidence']:.2f} |"
        )
    out.append("")
    return "\n".join(out)

START = "<!-- AUTO-GENERATED:START -->"
END = "<!-- AUTO-GENERATED:END -->"

try:
    with open(candidates_path, "r", encoding="utf-8") as f:
        md_text = f.read()
except FileNotFoundError:
    sys.exit(0)

i = md_text.find(START)
j = md_text.find(END)
if i < 0 or j < 0 or j < i:
    sys.exit(0)

new_block = (
    START + "\n\n"
    + build_active_section() + "\n"
    + build_orphan_section() + "\n"
    + build_decay_section() + "\n"
    + END
)
new_md = md_text[:i] + new_block + md_text[j + len(END):]
tmp = candidates_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    f.write(new_md)
os.replace(tmp, candidates_path)
PY

    exit 0
)

# --- Advisory 3: module Stop dispatch (gate: active modules) ---
printf '%s' "$_advisory_payload" | (
    # the module Stop dispatch — Stop dispatcher for module-contributed Stop hooks.
    #
    # Mirrors post-edit-dispatch.sh, but for the Stop event. If any DHPK modules are
    # active, fires their Stop hooks so a module can run end-of-response batch work
    # (e.g. the js module's batched ESLint over all files edited this response).
    #
    # Convention: module Stop hooks live at
    #   modules/<m>/hooks/stop-*.sh
    # and are invoked with the same stdin payload Claude Code passed us.
    #
    # Module Stop hooks run synchronously (Stop is not latency-critical like the
    # per-edit pipeline). Each hook is responsible for its own self-skip + must be
    # advisory (exit 0) — this dispatcher always exits 0 and never blocks Stop.
    #
    # Output handling: module hook stdout/stderr is captured into the per-session
    # findings file (the same file post-edit-dispatch.sh appends backgrounded
    # per-file lint to). At the end we surface the consolidated findings ONCE via a
    # systemMessage and clear the file (exit-0 stderr is inert — see _lib/json-out.sh).
    # minimal profile suppresses the surfaced message but still clears the file.

    PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

    . "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
    payload="$(dhpk_read_payload)"

    # Overlay project pluginConfigs so module selection respects per-project
    # .claude/settings.local.json (Claude Code only injects global pluginConfigs).
    . "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh" 2>/dev/null || true
    . "$PLUGIN_ROOT/scripts/hooks/_lib/json-out.sh" 2>/dev/null || true
    . "$PLUGIN_ROOT/scripts/hooks/_lib/modules.sh" 2>/dev/null || true

    : "${DHPK_ACTIVE_MODULES:=$(dhpk_config_modules)}"

    SESS="$(dhpk_sessions_dir)"
    FINDINGS="$SESS/$DHPK_SIDECAR_MODULE_FINDINGS"
    PROFILE="$(dhpk_config_profile)"

    if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
        mkdir -p "$SESS" 2>/dev/null || true
        while IFS= read -r _m; do
            for hook in "$PLUGIN_ROOT/modules/$_m/hooks/"stop-*.sh; do
                [ -f "$hook" ] || continue
                printf '%s' "$payload" | bash "$hook" >>"$FINDINGS" 2>&1 || true
            done
        done < <(active_modules_list)
    fi

    # Surface the consolidated module findings (per-file lint from
    # post-edit-dispatch.sh + batch checks above) once, then clear.
    if [ -s "$FINDINGS" ]; then
        if [ "$PROFILE" != "minimal" ]; then
            body="$(head -c 6000 "$FINDINGS" 2>/dev/null)"
            [ "$(wc -c < "$FINDINGS" 2>/dev/null || echo 0)" -gt 6000 ] && body="$body
... (truncated)"
            emit_system_message "[module-checks] findings from this turn:
$body"
        fi
        rm -f "$FINDINGS" 2>/dev/null || true
    fi

    exit 0
)

exit 0
