# OWASP Security Review Prompt Contract

<!-- Research block source of truth: ../shared/codex-research-instructions.md (Variant: Security Review) -->

This reference defines the prompt contract shared by the current-model primary
review and an explicitly requested CLI second opinion. The primary review does not
depend on an external transport. A CLI invocation is one-shot, read-only, and must
receive a self-contained prompt; it has no reply-thread continuation.

## Primary Review Prompt

Use this prompt in the primary review context after substituting `SCOPE` and
`CODE_CHANGES`:

````text
You are a senior security expert. Perform an OWASP Top 10 security review on the following code.

## Review Scope
${SCOPE}

## Code Changes
```diff
${CODE_CHANGES}
```

## Independent project research

Security review requires full context understanding. Proactively research:
- Search auth-related code: `rg -n "auth|token|session" src/ -l | head -10`
- Check input validation: `rg -n "@Body|@Query|@Param" src/ -A 5 | head -50`
- Check sensitive operations: `rg -n "password|secret|key" src/ -l`
- Read related files with bounded output, for example: `sed -n '1,100p' <file-path>`

## OWASP Top 10 Checklist

### A01: Broken Access Control
- IDOR (Insecure Direct Object References)
- Permission bypass
- CORS misconfiguration

### A02: Cryptographic Failures
- Unencrypted sensitive data
- Weak cryptographic algorithms (MD5, SHA1)
- Hardcoded keys

### A03: Injection
- SQL Injection
- NoSQL Injection (MongoDB)
- Command Injection
- XPath/LDAP Injection

### A04: Insecure Design
- Missing Rate Limiting
- Business logic vulnerabilities
- Missing input validation

### A05: Security Misconfiguration
- Debug mode not disabled
- Default passwords
- Error messages leaking information

### A06: Vulnerable Components
- Outdated/vulnerable dependencies
- Unpatched packages

### A07: Authentication Failures
- Weak password policies
- Session fixation attacks
- No brute force protection

### A08: Data Integrity Failures
- Insecure deserialization
- Missing integrity verification

### A09: Logging Failures
- Logging sensitive data (passwords, private keys)
- Missing audit logs

### A10: SSRF
- Unvalidated external URLs
- Access to internal network resources

## Output Format

### [P0/P1/P2] <Issue Title>
- **Location**: file:line
- **Type**: <OWASP Category>
- **Impact**: Potential harm description
- **Fix**: Specific fix recommendation
- **Test**: How to verify the fix

### Gate
- Mergeable: No P0
- Must fix: Has P0
- Unknown or unavailable evidence: state the limitation and keep the gate explicit
````

## Optional CLI Second-Opinion Prompt

Only when the caller explicitly selects `--second-opinion=codex-exec`, pass a
self-contained version of the primary prompt to the approved one-shot `codex exec`
CLI transport in read-only mode. The CLI result is an additional labeled source,
not a replacement for the primary review. Do not pass the primary conclusion, and
do not create a continuation/reply request.

The caller must record:

- the explicit option that enabled the invocation;
- the scope and change snapshot supplied to the CLI;
- the CLI exit status and bounded, redacted result;
- disagreements between the primary and CLI findings; and
- the final gate and any degradation reason.

If the option is absent or the CLI is unavailable, report exactly:
`degraded: primary model only — Only the primary model's verdict is present; no
independent review ran.`
