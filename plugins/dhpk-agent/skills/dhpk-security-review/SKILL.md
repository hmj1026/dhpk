---
name: dhpk-security-review
description: "Portable security review (OWASP Top 10) using the current model with an optional CLI second opinion. Use when: security audit, dependency vulnerability check, security-sensitive changes. Not for: code review (use dhpk-change-review), test review (use dhpk-test-review). Output: security findings, evidence, and an explicit audit gate."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Security Review Skill

## When NOT to Use

- General code review (use `dhpk-change-review`)
- Functional testing (use `dhpk-test-review`)
- Performance issues (not security-related)

## Review backends

The primary OWASP audit runs in the current model's isolated, read-only context and
does not require an external backend. The complete audit must work on this path
alone.

An independent second opinion is optional and explicit. When the caller selects
`--second-opinion=codex-exec`, send a self-contained copy of the scope, changes, and
prompt from `references/codex-prompt-security.md` to one-shot `codex exec` through
the CLI. Keep its findings separate until the final comparison; it is additive and
must never replace the primary audit or become a fallback. Do not use a reply-thread
continuation. If the CLI is unavailable or not requested, report
**degraded: primary model only** and state plainly: "Only the primary model's
verdict is present; no independent review ran."

## Commands

| Command | Purpose | When |
| --- | --- | --- |
| `/dhpk:dhpk-security-review` | Primary OWASP Top 10 audit with an optional explicit CLI opinion | Security-sensitive code |
| `/codex-security` | Deprecated alias forwarding to `dhpk-security-review` | Legacy callers; no separate backend |
| `/dep-audit` | Dependency security audit | Periodic / PR |

## Workflow

```
Determine scope → Collect changes → primary OWASP review → optional CLI opinion → Findings + Gate → Loop if Must fix
```

### Step 1: Determine Scope

Parse `--scope` from arguments, default to `src/`.

### Step 2: Collect Code Changes

Priority order:
1. Uncommitted changes: `git diff HEAD -- <scope> | head -1500`
2. Recent commits: `git diff HEAD~5..HEAD -- <scope> | head -1500`
3. Key security files: `Glob("**/*{auth,login,password,token,secret,key,credential}*")`

### Step 3: Primary OWASP Security Review

Apply the OWASP Top 10 checklist below directly against the collected changes using
the current model. For each category, inspect the relevant code paths (auth, input
handling, sensitive data, dependencies) and record any finding with severity.

### Step 4: Optional CLI second opinion

Only when `--second-opinion=codex-exec` is explicitly present, provide the same
self-contained scope and code snapshot to a fresh, read-only one-shot CLI reviewer.
Do not include the primary conclusion in that prompt. Record the CLI result as a
separate source, compare findings and evidence, and identify disagreements. If the
option is absent or the CLI fails, preserve the degraded primary-only state from
the review-backends contract; do not imply independent verification.

### Step 5: Consolidate Output

Organize results into a findings summary table, detailed findings, backend/degradation
state, and gate. A P0 finding remains a Must fix regardless of whether a second
opinion ran.

## OWASP Top 10

| Code | Category           | Check Focus                          |
| ---- | ------------------ | ------------------------------------ |
| A01  | Broken Access Ctrl | IDOR, permission bypass, CORS        |
| A02  | Crypto Failures    | Sensitive data encryption, weak crypto |
| A03  | Injection          | SQL/NoSQL/Cmd Injection              |
| A04  | Insecure Design    | Rate Limiting, business logic        |
| A05  | Misconfiguration   | Debug mode, default passwords        |
| A06  | Vulnerable Comp    | Known vulnerable dependencies        |
| A07  | Auth Failures      | Brute force, session, weak passwords |
| A08  | Integrity Failures | Deserialization, CI/CD               |
| A09  | Logging Failures   | Sensitive data in logs, auditing     |
| A10  | SSRF               | URL validation, internal network access |

## Output

Return a findings summary table, detailed evidence with file and line
locations, severity (P0/P1/P2), actionable remediation, verification method,
and an explicit `Mergeable` or `Must fix` gate. A dependency-only audit must
also state the command, advisory scope, and whether the result is advisory.

## Review Loop

Auto-loop semantics: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Anti-loop & output.

⛔ Must fix → fix P0 issues → re-audit the fixed code inline → repeat until ✅ Mergeable.

Max 3 rounds. Still failing → report blocker.

## Verification

- [ ] Each issue tagged with severity (P0/P1/P2)
- [ ] Gate is explicit (✅ Mergeable / ⛔ Must fix)
- [ ] Fix recommendations are specific and actionable
- [ ] Includes verification test method
- [ ] Auth / input / sensitive-data code paths inspected inline
- [ ] Optional CLI opinion is explicitly requested, independently prompted, and
  labeled separately, or the degraded primary-only state is recorded

## References

- OWASP prompt: `references/codex-prompt-security.md`
- Examples: `references/examples.md`

## Examples

```
Input: /dhpk:dhpk-security-review --scope src/controller/
Action: inline OWASP Top 10 check → output issues + Gate

Input: /dep-audit --level high
Action: npm audit → filter high/critical → output report
```
