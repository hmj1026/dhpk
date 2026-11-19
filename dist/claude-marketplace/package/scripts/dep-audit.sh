#!/usr/bin/env bash
# dep-audit.sh - 依賴安全審計
set -euo pipefail

LEVEL="moderate"  # low | moderate | high | critical
FIX=""

usage() {
  cat <<'EOF'
Usage:
  dep-audit.sh [--level <severity>] [--fix]

Options:
  --level <severity>  最低報告等級 (low|moderate|high|critical)，預設 moderate
  --fix               嘗試自動修復

Examples:
  dep-audit.sh                    # 報告 moderate 以上漏洞
  dep-audit.sh --level high       # 只報告 high/critical
  dep-audit.sh --fix              # 嘗試自動修復
EOF
}

# --- args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --level)
      if [[ $# -lt 2 || ! "${2:-}" =~ ^(low|moderate|high|critical)$ ]]; then
        echo "ERROR: --level requires one of: low, moderate, high, critical" >&2
        exit 2
      fi
      LEVEL="$2"
      shift 2
      ;;
    --fix) FIX="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

# 檢測包管理器
PM="npm"
if [[ -f yarn.lock ]]; then PM="yarn"; fi
if [[ -f pnpm-lock.yaml ]]; then PM="pnpm"; fi

echo "=== DEPENDENCY AUDIT ==="
echo "Package Manager: $PM"
echo "Minimum Level: $LEVEL"
echo ""

# 建立臨時目錄
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
AUDIT_FILE="$TMP_DIR/audit.json"
SUMMARY_FILE="$TMP_DIR/summary.txt"

# 執行審計
echo "[INFO] Running $PM audit..." >&2

# Bound the audit so a registry stall can never wedge the wrapper. On macOS,
# where GNU `timeout` is not installed by default, Perl's alarm provides a
# portable watchdog. Override the cap with DEP_AUDIT_TIMEOUT.
AUDIT_TIMEOUT="${DEP_AUDIT_TIMEOUT:-120}"
run_audit() {  # "$@" = the audit command + args
  if command -v timeout >/dev/null 2>&1; then
    timeout "$AUDIT_TIMEOUT" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$AUDIT_TIMEOUT" "$@"
  elif command -v perl >/dev/null 2>&1; then
    perl -e '
      use POSIX qw(:sys_wait_h);
      my $limit = shift;
      my $pid = fork();
      die "fork failed: $!" unless defined $pid;
      if ($pid == 0) {
        setpgrp(0, 0);
        exec @ARGV or exit 127;
      }
      $SIG{ALRM} = sub {
        kill "TERM", -$pid;
        sleep 1;
        kill "KILL", -$pid;
        waitpid($pid, 0);
        exit 124;
      };
      alarm $limit;
      waitpid($pid, 0);
      alarm 0;
      my $status = $?;
      exit WIFEXITED($status) ? WEXITSTATUS($status) : 128 + WTERMSIG($status);
    ' "$AUDIT_TIMEOUT" "$@"
  else
    echo "ERROR: a timeout utility or Perl is required to bound the audit." >&2
    return 127
  fi
}

if [[ ! "$AUDIT_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: DEP_AUDIT_TIMEOUT must be a positive whole number of seconds." >&2
  exit 1
fi

set +e
case "$PM" in
  yarn)
    run_audit yarn audit --json > "$AUDIT_FILE" 2>/dev/null
    AUDIT_EXIT=$?
    ;;
  pnpm)
    run_audit pnpm audit --json > "$AUDIT_FILE" 2>/dev/null
    AUDIT_EXIT=$?
    ;;
  *)
    run_audit npm audit --json > "$AUDIT_FILE" 2>/dev/null
    AUDIT_EXIT=$?
    ;;
esac
set -e

# Evidence is required before a result can be counted, gated, or fixed.
fail_audit() {
  echo "ERROR: $1" >&2
  echo ""
  echo "## Gate"
  echo ""
  echo "❌ **FAIL** - 審計未完成，不能確認依賴安全狀態"
  exit 1
}

if ! command -v jq >/dev/null 2>&1; then
  fail_audit "jq is required to validate audit output."
fi
if [[ ! -s "$AUDIT_FILE" ]]; then
  fail_audit "The package manager produced no audit output (exit $AUDIT_EXIT)."
fi

if [[ "$PM" == "yarn" ]]; then
  if ! jq -s -e '
    def count: type == "number" and . >= 0 and floor == . and . <= 2147483647;
    def severity: . == "info" or . == "low" or . == "moderate" or . == "high" or . == "critical";
    def valid_counts:
      type == "object"
      and (.info | count)
      and (.low | count)
      and (.moderate | count)
      and (.high | count)
      and (.critical | count)
      and (.total | count)
      and (.total == (.info + .low + .moderate + .high + .critical));
    length > 0
    and all(.[]; type == "object" and (.type | type == "string"))
    and all(.[]; .type == "auditAdvisory" or .type == "auditSummary" or .type == "info" or .type == "warning")
    and ([.[] | select(.type == "auditSummary")] | length == 1)
    and all(.[] | select(.type == "auditAdvisory");
      .data.advisory.severity as $severity
      | ($severity | severity))
    and (
      [.[] | select(.type == "auditSummary")][0].data.vulnerabilities as $counts
      | ($counts | valid_counts)
      and ($counts.info == ([.[] | select(.type == "auditAdvisory" and .data.advisory.severity == "info")] | length))
      and ($counts.low == ([.[] | select(.type == "auditAdvisory" and .data.advisory.severity == "low")] | length))
      and ($counts.moderate == ([.[] | select(.type == "auditAdvisory" and .data.advisory.severity == "moderate")] | length))
      and ($counts.high == ([.[] | select(.type == "auditAdvisory" and .data.advisory.severity == "high")] | length))
      and ($counts.critical == ([.[] | select(.type == "auditAdvisory" and .data.advisory.severity == "critical")] | length))
    )
  ' "$AUDIT_FILE" >/dev/null 2>&1; then
    fail_audit "The package manager produced malformed Yarn audit output."
  fi
  read -r INFO CRITICAL HIGH MODERATE LOW REPORT_TOTAL < <(
    jq -s -r '[.[] | select(.type == "auditSummary")][0].data.vulnerabilities | [.info, .critical, .high, .moderate, .low, .total] | @tsv' "$AUDIT_FILE"
  )
else
  if ! jq -s -e '
    def count: type == "number" and . >= 0 and floor == . and . <= 2147483647;
    def severity: . == "info" or . == "low" or . == "moderate" or . == "high" or . == "critical";
    length == 1
    and (
      .[0] as $report
      | ($report | type == "object")
      and ($report.auditReportVersion == 2)
      and ($report.vulnerabilities | type == "object")
      and all($report.vulnerabilities[]; type == "object" and (.severity | severity))
      and ($report.metadata.vulnerabilities | type == "object")
      and ($report.metadata.vulnerabilities.info | count)
      and ($report.metadata.vulnerabilities.low | count)
      and ($report.metadata.vulnerabilities.moderate | count)
      and ($report.metadata.vulnerabilities.high | count)
      and ($report.metadata.vulnerabilities.critical | count)
      and ($report.metadata.vulnerabilities.total | count)
      and ($report.metadata.vulnerabilities.total == (
        $report.metadata.vulnerabilities.info
        + $report.metadata.vulnerabilities.low
        + $report.metadata.vulnerabilities.moderate
        + $report.metadata.vulnerabilities.high
        + $report.metadata.vulnerabilities.critical
      ))
      and ($report.metadata.vulnerabilities.info == ([$report.vulnerabilities[] | select(.severity == "info")] | length))
      and ($report.metadata.vulnerabilities.low == ([$report.vulnerabilities[] | select(.severity == "low")] | length))
      and ($report.metadata.vulnerabilities.moderate == ([$report.vulnerabilities[] | select(.severity == "moderate")] | length))
      and ($report.metadata.vulnerabilities.high == ([$report.vulnerabilities[] | select(.severity == "high")] | length))
      and ($report.metadata.vulnerabilities.critical == ([$report.vulnerabilities[] | select(.severity == "critical")] | length))
    )
  ' "$AUDIT_FILE" >/dev/null 2>&1; then
    fail_audit "The package manager produced malformed $PM audit JSON."
  fi
  read -r INFO CRITICAL HIGH MODERATE LOW REPORT_TOTAL < <(
    jq -s -r '.[0].metadata.vulnerabilities | [.info, .critical, .high, .moderate, .low, .total] | @tsv' "$AUDIT_FILE"
  )
fi

if [[ "$PM" == "yarn" ]]; then
  # Yarn Classic returns a sum of one flag per severity with findings:
  # info=1, low=2, moderate=4, high=8, critical=16.
  EXPECTED_AUDIT_EXIT=0
  [[ "$INFO" -gt 0 ]] && EXPECTED_AUDIT_EXIT=$((EXPECTED_AUDIT_EXIT + 1))
  [[ "$LOW" -gt 0 ]] && EXPECTED_AUDIT_EXIT=$((EXPECTED_AUDIT_EXIT + 2))
  [[ "$MODERATE" -gt 0 ]] && EXPECTED_AUDIT_EXIT=$((EXPECTED_AUDIT_EXIT + 4))
  [[ "$HIGH" -gt 0 ]] && EXPECTED_AUDIT_EXIT=$((EXPECTED_AUDIT_EXIT + 8))
  [[ "$CRITICAL" -gt 0 ]] && EXPECTED_AUDIT_EXIT=$((EXPECTED_AUDIT_EXIT + 16))
  if [[ "$AUDIT_EXIT" -ne "$EXPECTED_AUDIT_EXIT" ]]; then
    fail_audit "The yarn audit command failed or returned an exit code inconsistent with its report (exit $AUDIT_EXIT, expected $EXPECTED_AUDIT_EXIT)."
  fi
elif [[ "$AUDIT_EXIT" -ne 0 && ( "$AUDIT_EXIT" -ne 1 || "$REPORT_TOTAL" -eq 0 ) ]]; then
  # npm and pnpm use exit 1 for valid reports containing findings.
  fail_audit "The $PM audit command failed (exit $AUDIT_EXIT)."
fi

echo "## 審計結果" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

# 輸出摘要表格
echo "| Severity | Count |" >> "$SUMMARY_FILE"
echo "|:---------|------:|" >> "$SUMMARY_FILE"
echo "| Critical | $CRITICAL |" >> "$SUMMARY_FILE"
echo "| High | $HIGH |" >> "$SUMMARY_FILE"
echo "| Moderate | $MODERATE |" >> "$SUMMARY_FILE"
echo "| Low | $LOW |" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

# 計算總數
TOTAL=$((CRITICAL + HIGH + MODERATE + LOW))

# 判斷是否通過
PASS="yes"
case "$LEVEL" in
  critical)
    if [[ $CRITICAL -gt 0 ]]; then PASS="no"; fi
    ;;
  high)
    if [[ $CRITICAL -gt 0 || $HIGH -gt 0 ]]; then PASS="no"; fi
    ;;
  moderate)
    if [[ $CRITICAL -gt 0 || $HIGH -gt 0 || $MODERATE -gt 0 ]]; then PASS="no"; fi
    ;;
  low)
    if [[ $TOTAL -gt 0 ]]; then PASS="no"; fi
    ;;
esac

# 詳細漏洞列表
if [[ $TOTAL -gt 0 ]]; then
  echo "## 漏洞詳情" >> "$SUMMARY_FILE"
  echo "" >> "$SUMMARY_FILE"

  if [[ "$PM" == "yarn" ]]; then
    jq -r 'select(.type == "auditAdvisory") | "### [\(.data.advisory.severity)] \(.data.advisory.title // "Unknown")\n- **Package**: \(.data.advisory.module_name // "unknown")\n- **URL**: \(.data.advisory.url // "")\n"' "$AUDIT_FILE" >> "$SUMMARY_FILE"
  else
    # npm audit 格式
    if command -v jq >/dev/null 2>&1; then
      jq -r '.vulnerabilities | to_entries[] | "### [\(.value.severity)] \(.key)\n- **Via**: \(.value.via | if type == "array" then .[0] | if type == "string" then . else .title // "Unknown" end else . end)\n- **Fix**: \(.value.fixAvailable | if type == "boolean" then if . then "Available" else "Not available" end else "Run npm audit fix" end)\n"' "$AUDIT_FILE" 2>/dev/null >> "$SUMMARY_FILE" || true
    fi
  fi
fi

# 輸出結果
cat "$SUMMARY_FILE"

# Gate 判斷
echo ""
echo "## Gate"
echo ""
if [[ "$PASS" == "yes" ]]; then
  echo "✅ **PASS** - 無 $LEVEL 或以上等級漏洞"
else
  echo "❌ **FAIL** - 發現 $LEVEL 或以上等級漏洞"
  echo ""
  echo "### 修復建議"
  echo ""
  echo "\`\`\`bash"
  if [[ "$PM" == "yarn" ]]; then
    echo "yarn upgrade-interactive"
  else
    echo "$PM audit fix"
  fi
  echo "\`\`\`"
fi

# 自動修復
if [[ "$FIX" == "yes" ]]; then
  echo ""
  echo "## 嘗試自動修復"
  echo ""
  set +e
  if [[ "$PM" == "yarn" ]]; then
    echo "[INFO] yarn audit fix is not directly supported, try: yarn upgrade" >&2
    yarn upgrade --pattern "*" 2>&1 | tail -20 || true
  else
    $PM audit --fix 2>&1 | tail -20 || true
  fi
  set -e
fi

echo ""
echo "=== END ==="

# 返回適當的退出碼
if [[ "$PASS" == "no" ]]; then
  exit 1
fi
exit 0
