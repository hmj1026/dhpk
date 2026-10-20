# Security policy

> **Languages**: **English** · [繁體中文](./SECURITY.zh-TW.md)

## Supported versions

Only the latest minor release line receives security fixes. Older lines do not
receive backports; upgrade to the latest release to get a fix.

| Version | Security fixes |
|---|---|
| Latest minor (see [tags](https://github.com/hmj1026/dhpk/tags)) | Yes |
| Older minors | No |

## Reporting a vulnerability

Report vulnerabilities privately through GitHub private vulnerability
reporting: open the repository's **Security** tab and choose
**Report a vulnerability**, or go directly to
<https://github.com/hmj1026/dhpk/security/advisories/new>.

Do not open a public issue, pull request, or discussion for a suspected
vulnerability.

Include what you can of the following:

- affected version or commit, and the Host (Claude Code, Codex, or Cursor)
- the affected component (for example a hook, installer, or generated file)
- reproduction steps or a proof of concept
- the impact you observed or expect

## Response

- First response within 7 days of the report.
- A fix release targeted within 90 days, on a best-effort basis. Complex issues
  may take longer; you will be kept informed in the private advisory.
- Disclosure is coordinated with the reporter. The advisory is published after
  a fixed release is available.

## Scope

In scope:

- hooks and the scripts they run on the user's machine
- installers, sync, and update scripts
- generated outputs committed to this repository
- published plugin packages built from this repository

Out of scope:

- code in the user's own project that dhpk reviews or edits
- vulnerabilities in third-party tools or services that dhpk integrates with
  (for example Claude Code, Codex, Cursor, OpenSpec, or MCP servers); report
  those to their maintainers
- findings that require an attacker who already controls the user's machine
  or repository configuration
