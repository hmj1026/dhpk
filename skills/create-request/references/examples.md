# Create-Request Examples

Worked input → action examples for each mode.

## Create Mode

```
Input: /create-request Feature: Auth Title: Fix validation Priority: P1
Action: Explore related code -> Fill template -> Create file -> Suggest next steps
```

```
Input: Create a request document
Action: Ask for required info -> Explore -> Create -> Confirm
```

## Update Mode

```
Input: /create-request --update docs/features/auth/requests/2026-01-23-fix-login-validation.md
Action: Read request -> Analyze git changes -> Update Progress -> Output summary
```

```
Input: Update request progress
Action: Identify request from context -> Analyze implementation -> Auto-update -> Confirm
```

```
Input: (after development complete) Sync request document
Action:
  1. Read Related Files
  2. git log to check changes
  3. Update: Development unchecked -> done, Testing unchecked -> in progress
  4. Check completed Acceptance Criteria
  5. Status: Pending -> In Progress
```
