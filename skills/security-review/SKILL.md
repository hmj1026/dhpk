---
name: security-review
description: 'Security review (OWASP Top 10), codex-free. Use when: security audit, dependency vulnerability check, security-sensitive changes. For a Codex-driven audit, use /codex-security instead. Not for: code review (use codex-code-review), test review (use test-review). Output: security findings + audit report.'
argument-hint: '[--scope <path>]'
allowed-tools: 'Bash(git:*), Read, Grep, Glob'
context: fork
agent: Explore
---

# Security Review Skill

## Trigger

- Keywords: security review, OWASP, vulnerability, dep-audit, npm audit, dependency security

## When NOT to Use

- General code review (use `codex-code-review`)
- Functional testing (use `test-review`)
- Performance issues (not security-related)

## Codex isolation

This skill is **codex-free**: the OWASP Top 10 audit is performed inline (it runs in
an isolated read-only fork; apply the OWASP Top 10 checklist below directly against the
collected changes). It needs no Codex CLI/MCP and MUST NOT call any `mcp__codex__*`
tool — its `allowed-tools` deliberately omits it.

For a **Codex-driven** audit (independent second opinion), use the dedicated
**`/codex-security`** command instead — that command owns the `mcp__codex__*` permission
and drives the Codex review. `/dhpk:do --codex` routes security tasks there.

## Commands

| Command           | Purpose                                   | When                        |
| ----------------- | ----------------------------------------- | --------------------------- |
| `/security-review`| OWASP Top 10 audit — codex-free (inline)  | Security-sensitive code     |
| `/codex-security` | OWASP audit via Codex                     | Want a Codex second opinion |
| `/dep-audit`      | Dependency security audit                 | Periodic / PR               |

## Workflow

```
Determine scope → Collect changes → inline OWASP review → Findings + Gate → Loop if Must fix
```

### Step 1: Determine Scope

Parse `--scope` from arguments, default to `src/`.

### Step 2: Collect Code Changes

Priority order:
1. Uncommitted changes: `git diff HEAD -- <scope> | head -1500`
2. Recent commits: `git diff HEAD~5..HEAD -- <scope> | head -1500`
3. Key security files: `Glob("**/*{auth,login,password,token,secret,key,credential}*")`

### Step 3: OWASP Security Review (inline)

Apply the OWASP Top 10 checklist below directly against the collected changes. For each
category, inspect the relevant code paths (auth, input handling, sensitive data,
dependencies) and record any finding with severity. No Codex.

(For a Codex-driven audit, stop here and use `/codex-security` instead.)

### Step 4: Consolidate Output

Organize results into findings summary table + detailed findings + gate.

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

## Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

⛔ Must fix → fix P0 issues → re-audit the fixed code inline → repeat until ✅ Mergeable.

Max 3 rounds. Still failing → report blocker.

## Verification

- [ ] Each issue tagged with severity (P0/P1/P2)
- [ ] Gate is explicit (✅ Mergeable / ⛔ Must fix)
- [ ] Fix recommendations are specific and actionable
- [ ] Includes verification test method
- [ ] Auth / input / sensitive-data code paths inspected inline

## References

- OWASP prompt: `references/codex-prompt-security.md`
- Examples: `references/examples.md`
- Standards: @rules/security.md

## Examples

```
Input: /security-review --scope src/controller/
Action: inline OWASP Top 10 check → output issues + Gate

Input: /dep-audit --level high
Action: npm audit → filter high/critical → output report
```
