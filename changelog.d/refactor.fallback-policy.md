scope: dispatch
note: Dispatch fallback and recovery substitution now share one Fallback Policy, so recovery also excludes targets in the resolution fallback history, refuses a substitute when the resolution is not fallback-eligible, and carries the full tried-target union in its next request; dispatch config diagnostics use the same catalog route matcher (#1244).
