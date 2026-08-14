#!/usr/bin/env bash
set -euo pipefail

# run-bounded-node-test.sh
# 限制 Node.js 測試或腳本的記憶體上限與執行時間，防止失控吃滿主機資源造成 OOM。

MEMORY_MAX="${MEMORY_MAX:-2G}"
MEMORY_SWAP_MAX="${MEMORY_SWAP_MAX:-1G}"
# The aggregate test runner enforces a 60s timeout per child.  Keep the outer
# batch bound longer so one slow child is recorded as a failure instead of
# terminating the whole aggregate before it can continue.
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-900s}"
VIRTUAL_MEMORY_MAX="${VIRTUAL_MEMORY_MAX:-4G}"
REQUIRE_CGROUP="${DHPK_BOUNDED_REQUIRE_CGROUP:-1}"
ALLOW_FALLBACK="${DHPK_BOUNDED_ALLOW_FALLBACK:-0}"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 2
fi

parse_duration_seconds() {
  local raw="$1" digits suffix multiplier
  if [[ ! "$raw" =~ ^([1-9][0-9]*)(s|m|h|d)?$ ]]; then return 1; fi
  digits="${BASH_REMATCH[1]}"
  suffix="${BASH_REMATCH[2]:-s}"
  if [ "${#digits}" -gt 6 ]; then return 1; fi
  multiplier=1
  case "$suffix" in
    s) multiplier=1;;
    m) multiplier=60;;
    h) multiplier=3600;;
    d) multiplier=86400;;
    *) return 1;;
  esac
  local seconds=$((10#${digits} * multiplier))
  if [ "$seconds" -le 0 ] || [ "$seconds" -gt 604800 ]; then return 1; fi
  printf '%s' "$seconds"
}

parse_size_bytes() {
  local raw="$1" digits suffix multiplier
  if [[ ! "$raw" =~ ^([1-9][0-9]*)(K|M|G)$ ]]; then return 1; fi
  digits="${BASH_REMATCH[1]}"
  suffix="${BASH_REMATCH[2]}"
  if [ "${#digits}" -gt 6 ]; then return 1; fi
  multiplier=1024
  case "$suffix" in
    K) multiplier=1024;;
    M) multiplier=$((1024 * 1024));;
    G) multiplier=$((1024 * 1024 * 1024));;
    *) return 1;;
  esac
  local bytes=$((10#${digits} * multiplier))
  if [ "$bytes" -le 0 ] || [ "$bytes" -gt $((16 * 1024 * 1024 * 1024)) ]; then return 1; fi
  printf '%s' "$bytes"
}

TIMEOUT_SECONDS_VALUE="$(parse_duration_seconds "$TIMEOUT_SECONDS")" || {
  echo "[run-bounded-node-test] ERROR: TIMEOUT_SECONDS must be a positive duration <= 7d (for example 900s)" >&2
  exit 125
}
MEMORY_MAX_BYTES="$(parse_size_bytes "$MEMORY_MAX")" || {
  echo "[run-bounded-node-test] ERROR: MEMORY_MAX must be a positive size <= 16G (for example 2G)" >&2
  exit 125
}
MEMORY_SWAP_MAX_BYTES="$(parse_size_bytes "$MEMORY_SWAP_MAX")" || {
  echo "[run-bounded-node-test] ERROR: MEMORY_SWAP_MAX must be a positive size <= 16G (for example 1G)" >&2
  exit 125
}
VIRTUAL_MEMORY_BYTES="$(parse_size_bytes "$VIRTUAL_MEMORY_MAX")" || {
  echo "[run-bounded-node-test] ERROR: VIRTUAL_MEMORY_MAX must be a positive size <= 16G (for example 4G)" >&2
  exit 125
}
if [ "$REQUIRE_CGROUP" != '0' ] && [ "$REQUIRE_CGROUP" != '1' ]; then
  echo "[run-bounded-node-test] ERROR: DHPK_BOUNDED_REQUIRE_CGROUP must be 0 or 1" >&2
  exit 125
fi
if [ "$ALLOW_FALLBACK" != '0' ] && [ "$ALLOW_FALLBACK" != '1' ]; then
  echo "[run-bounded-node-test] ERROR: DHPK_BOUNDED_ALLOW_FALLBACK must be 0 or 1" >&2
  exit 125
fi
export DHPK_BOUNDED_EXPECT_MEMORY_MAX_BYTES="$MEMORY_MAX_BYTES"
export DHPK_BOUNDED_EXPECT_MEMORY_SWAP_MAX_BYTES="$MEMORY_SWAP_MAX_BYTES"

ACTIVE_SCOPE_UNIT=''
ACTIVE_SCOPE_TOKEN=''
PENDING_SCOPE_PID=''
PENDING_SCOPE_READY=''
CLEANUP_STATUS=0
HANDSHAKE_TIMEOUT_SECONDS=3

scope_description() {
  printf 'DHPK bounded Node scope token=%s' "$1"
}

scope_probe() {
  local unit="$1"
  SCOPE_DESCRIPTION_VALUE=''
  SCOPE_ACTIVE_STATE=''
  SCOPE_LOAD_STATE=''
  if ! SCOPE_DESCRIPTION_VALUE=$(systemctl --user show "$unit" --property=Description --value 2>/dev/null); then return 2; fi
  if ! SCOPE_ACTIVE_STATE=$(systemctl --user show "$unit" --property=ActiveState --value 2>/dev/null); then return 2; fi
  if ! SCOPE_LOAD_STATE=$(systemctl --user show "$unit" --property=LoadState --value 2>/dev/null); then return 2; fi
  if [ "$SCOPE_LOAD_STATE" = 'not-found' ]; then return 3; fi
  return 0
}

scope_is_owned() {
  local unit="$1" token="$2"
  scope_probe "$unit" || return $?
  [ "$SCOPE_DESCRIPTION_VALUE" = "$(scope_description "$token")" ] && [ "$SCOPE_ACTIVE_STATE" = 'active' ]
}

wait_scope_inactive() {
  local unit="$1" probe_status state
  # systemd can report a transient stop failure while the scope is already
  # draining.  Keep the fail-closed contract by accepting only a bounded,
  # positively observed inactive/dead/not-found state; query errors remain a
  # containment failure.
  for ((i = 0; i < 300; i += 1)); do
    if scope_probe "$unit"; then
      state="$SCOPE_ACTIVE_STATE"
      if [ "$state" = 'inactive' ] || [ "$state" = 'dead' ]; then return 0; fi
    else
      probe_status=$?
      if [ "$probe_status" -eq 3 ]; then return 0; fi
      return 125
    fi
    sleep 0.01
  done
  return 1
}

cleanup_handshake() {
  if [ -n "${PENDING_SCOPE_READY}" ]; then
    local handshake_root
    handshake_root=$(dirname "$PENDING_SCOPE_READY")
    rm -rf -- "$handshake_root"
    PENDING_SCOPE_READY=''
  fi
}

cleanup_scope() {
  if [ -z "${ACTIVE_SCOPE_UNIT}" ]; then
    return 0
  fi
  local unit="$ACTIVE_SCOPE_UNIT" token="$ACTIVE_SCOPE_TOKEN" probe_status state
  # systemd-run waits for the main process, not necessarily for descendants
  # that called setsid()/detached.  Kill every process still in the transient
  # scope before returning so a timed-out child cannot outlive this wrapper.
  if scope_is_owned "$unit" "$token"; then
    :
  else
    probe_status=$?
    if [ "$probe_status" -eq 3 ]; then
      ACTIVE_SCOPE_UNIT=''
      ACTIVE_SCOPE_TOKEN=''
      return 0
    fi
    echo "[run-bounded-node-test] ERROR: refusing cleanup because scope state could not be verified (${unit})" >&2
    CLEANUP_STATUS=125
    return 1
  fi
  if ! systemctl --user kill --kill-whom=all --signal=SIGKILL "$unit" >/dev/null 2>&1; then
    if scope_probe "$unit"; then
      state="$SCOPE_ACTIVE_STATE"
      if [ "$state" = 'inactive' ] || [ "$state" = 'dead' ]; then
        ACTIVE_SCOPE_UNIT=''
        ACTIVE_SCOPE_TOKEN=''
        return 0
      fi
    elif [ "$?" -eq 3 ]; then
      ACTIVE_SCOPE_UNIT=''
      ACTIVE_SCOPE_TOKEN=''
      return 0
    fi
    echo "[run-bounded-node-test] ERROR: failed to kill every process in scope ${unit}" >&2
    CLEANUP_STATUS=125
    return 1
  fi
  if ! systemctl --user stop "$unit" >/dev/null 2>&1; then
    if wait_scope_inactive "$unit"; then
      ACTIVE_SCOPE_UNIT=''
      ACTIVE_SCOPE_TOKEN=''
      return 0
    fi
    echo "[run-bounded-node-test] ERROR: failed to stop scope ${unit}" >&2
    CLEANUP_STATUS=125
    return 1
  fi
  for ((i = 0; i < 100; i += 1)); do
    if scope_probe "$unit"; then
      state="$SCOPE_ACTIVE_STATE"
    else
      probe_status=$?
      if [ "$probe_status" -eq 3 ]; then
        ACTIVE_SCOPE_UNIT=''
        ACTIVE_SCOPE_TOKEN=''
        return 0
      fi
      echo "[run-bounded-node-test] ERROR: scope state query failed during cleanup (${unit})" >&2
      CLEANUP_STATUS=125
      return 1
    fi
    if [ "$state" = 'inactive' ] || [ "$state" = 'dead' ]; then
      ACTIVE_SCOPE_UNIT=''
      ACTIVE_SCOPE_TOKEN=''
      return 0
    fi
    sleep 0.01
  done
  echo "[run-bounded-node-test] ERROR: scope ${unit} remains active after kill; containment is unverified" >&2
  CLEANUP_STATUS=125
  return 1
}

abort_pending_scope() {
  if [ -n "${PENDING_SCOPE_PID}" ] && kill -0 "${PENDING_SCOPE_PID}" 2>/dev/null; then
    kill "${PENDING_SCOPE_PID}" 2>/dev/null || true
    wait "${PENDING_SCOPE_PID}" 2>/dev/null || true
    sleep "${HANDSHAKE_TIMEOUT_SECONDS}"
  fi
  PENDING_SCOPE_PID=''
  cleanup_handshake
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  cleanup_scope || true
  abort_pending_scope
  if [ "${CLEANUP_STATUS}" -ne 0 ]; then
    exit 125
  fi
  exit "${exit_code}"
}

on_signal() {
  cleanup_scope || true
  abort_pending_scope
  if [ "${CLEANUP_STATUS}" -ne 0 ]; then
    exit 125
  fi
  exit 143
}

trap on_exit EXIT
trap on_signal HUP INT TERM

START_TS=$(date +%s)

# A timeout binary is mandatory.  Running an unbounded command is not a safe
# fallback for a script whose purpose is to contain memory failures.
if ! command -v timeout >/dev/null 2>&1; then
  echo "[run-bounded-node-test] ERROR: timeout command is unavailable; refusing to run unbounded" >&2
  exit 127
fi
if ! command -v mktemp >/dev/null 2>&1; then
  echo "[run-bounded-node-test] ERROR: mktemp command is unavailable; refusing to run an unverified scope" >&2
  exit 127
fi

run_fallback() {
  echo "[run-bounded-node-test] WARNING: explicit virtual-memory fallback (${VIRTUAL_MEMORY_MAX}); aggregate descendant containment is unavailable" >&2
  export NODE_OPTIONS="--max-old-space-size=2048 ${NODE_OPTIONS:-}"
  local virtual_memory_kib
  virtual_memory_kib=$(( VIRTUAL_MEMORY_BYTES / 1024 ))
  if command -v prlimit >/dev/null 2>&1; then
    prlimit --as="${VIRTUAL_MEMORY_BYTES}" -- timeout --kill-after=5s "${TIMEOUT_SECONDS}" "$@"
    return $?
  fi
  (
    ulimit -v "${virtual_memory_kib}"
    timeout --kill-after=5s "${TIMEOUT_SECONDS}" "$@"
  )
}

run_in_scope() {
  local scope_token scope_unit launcher_pid exit_code claimed=0 query_failed=0 handshake_root ready_file
  scope_token=$(cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '[:space:]-' || true)
  if [ -z "$scope_token" ]; then
    echo "[run-bounded-node-test] ERROR: cannot obtain a secure scope token" >&2
    return 125
  fi
  scope_unit="dhpk-bounded-node-${scope_token}.scope"
  handshake_root=$(mktemp -d "${TMPDIR:-/tmp}/dhpk-bounded-handshake.XXXXXX") || {
    echo "[run-bounded-node-test] ERROR: cannot create scope handshake directory" >&2
    return 125
  }
  chmod 700 "$handshake_root"
  ready_file="${handshake_root}/ready"
  PENDING_SCOPE_READY="$ready_file"
  export DHPK_BOUNDED_READY_FILE="$ready_file"
  export DHPK_BOUNDED_HANDSHAKE_TIMEOUT_SECONDS="$HANDSHAKE_TIMEOUT_SECONDS"
  systemd-run --user --scope \
    --unit="${scope_unit}" \
    --description="$(scope_description "$scope_token")" \
    -p "MemoryMax=${MEMORY_MAX}" \
    -p "MemorySwapMax=${MEMORY_SWAP_MAX}" \
    --quiet \
    bash -c '
      set -euo pipefail
      cgroup_path=$(sed -n "s/^0:://p" /proc/self/cgroup)
      if [ -z "${cgroup_path}" ]; then
        echo "[run-bounded-node-test] ERROR: cgroup v2 path is unavailable" >&2
        exit 125
      fi
      cgroup_root="/sys/fs/cgroup${cgroup_path}"
      memory_limit=$(cat "${cgroup_root}/memory.max" 2>/dev/null || true)
      swap_limit=$(cat "${cgroup_root}/memory.swap.max" 2>/dev/null || true)
      if [ -z "${memory_limit}" ] || [ "${memory_limit}" = max ] || ! [[ "${memory_limit}" =~ ^[0-9]+$ ]]; then
        echo "[run-bounded-node-test] ERROR: effective memory.max is not finite" >&2
        exit 125
      fi
      if [ -z "${swap_limit}" ] || [ "${swap_limit}" = max ] || ! [[ "${swap_limit}" =~ ^[0-9]+$ ]]; then
        echo "[run-bounded-node-test] ERROR: effective memory.swap.max is not finite" >&2
        exit 125
      fi
      if [ "${memory_limit}" -gt "${DHPK_BOUNDED_EXPECT_MEMORY_MAX_BYTES}" ]; then
        echo "[run-bounded-node-test] ERROR: effective memory.max exceeds requested cap" >&2
        exit 125
      fi
      if [ "${swap_limit}" -gt "${DHPK_BOUNDED_EXPECT_MEMORY_SWAP_MAX_BYTES}" ]; then
        echo "[run-bounded-node-test] ERROR: effective memory.swap.max exceeds requested cap" >&2
        exit 125
      fi
      echo "[run-bounded-node-test] cgroup memory.max=${memory_limit} memory.swap.max=${swap_limit:-unavailable}" >&2
      ready_file="${DHPK_BOUNDED_READY_FILE:-}"
      deadline=$((SECONDS + DHPK_BOUNDED_HANDSHAKE_TIMEOUT_SECONDS))
      if [ -z "$ready_file" ]; then
        echo "[run-bounded-node-test] ERROR: scope readiness path is missing" >&2
        exit 125
      fi
      while [ ! -f "$ready_file" ]; do
        if [ "$SECONDS" -ge "$deadline" ]; then
          echo "[run-bounded-node-test] ERROR: scope ownership handshake timed out" >&2
          exit 125
        fi
        sleep 0.01
      done
      exec "$@"
    ' -- timeout --kill-after=5s "${TIMEOUT_SECONDS}" "$@" &
  launcher_pid=$!
  PENDING_SCOPE_PID="$launcher_pid"
  # Claim the unit only after systemd reports the exact ownership marker and an
  # active state. If creation fails or a unit name collides, no cleanup command
  # is authorized for that name.
  for ((i = 0; i < 500; i += 1)); do
    if scope_is_owned "$scope_unit" "$scope_token"; then
      ACTIVE_SCOPE_UNIT="$scope_unit"
      ACTIVE_SCOPE_TOKEN="$scope_token"
      : > "$ready_file"
      claimed=1
      break
    fi
    probe_status=$?
    [ "$probe_status" -eq 2 ] && query_failed=1
    if ! kill -0 "$launcher_pid" 2>/dev/null; then
      break
    fi
    sleep 0.01
  done
  if [ "$claimed" -eq 0 ] && kill -0 "$launcher_pid" 2>/dev/null; then
    echo "[run-bounded-node-test] ERROR: scope ownership could not be verified" >&2
    kill "$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
    PENDING_SCOPE_PID=''
    [ "$query_failed" -eq 1 ] && sleep "$HANDSHAKE_TIMEOUT_SECONDS"
    cleanup_handshake
    return 125
  fi
  wait "$launcher_pid"
  exit_code=$?
  PENDING_SCOPE_PID=''
  # A very short command may finish between the polling check and wait. Claim
  # only if the marker is still exact; otherwise there is no owned scope left.
  if [ "$claimed" -eq 0 ] && scope_is_owned "$scope_unit" "$scope_token"; then
    ACTIVE_SCOPE_UNIT="$scope_unit"
    ACTIVE_SCOPE_TOKEN="$scope_token"
  fi
  cleanup_scope || return 125
  cleanup_handshake
  return "${exit_code}"
}

if command -v systemd-run >/dev/null 2>&1 \
  && command -v systemctl >/dev/null 2>&1 \
  && systemd-run --user --scope true >/dev/null 2>&1; then
  set +e
  run_in_scope "$@"
  EXIT_CODE=$?
  set -e
elif [ "${REQUIRE_CGROUP}" = "1" ] || [ "${ALLOW_FALLBACK}" != "1" ]; then
  echo "[run-bounded-node-test] ERROR: verified systemd cgroup is unavailable" >&2
  exit 125
else
  set +e
  run_fallback "$@"
  EXIT_CODE=$?
  set -e
fi

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

if [ "${EXIT_CODE}" -eq 124 ]; then
  echo "[run-bounded-node-test] ERROR: Command timed out after ${TIMEOUT_SECONDS} (elapsed: ${ELAPSED}s)" >&2
elif [ "${EXIT_CODE}" -ne 0 ]; then
  echo "[run-bounded-node-test] Command exited with code ${EXIT_CODE} (elapsed: ${ELAPSED}s)" >&2
fi

exit "${EXIT_CODE}"
