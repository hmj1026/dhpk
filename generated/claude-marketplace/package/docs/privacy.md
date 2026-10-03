# Privacy policy — DHPK OpenAI Plugin candidate

> **Publication status: DRAFT.** This page is not yet a published or approved
> policy. The candidate manifest links to the `develop` branch; do not submit
> that URL until this text has been reviewed and is publicly available.

This draft describes the proposed skills-only DHPK plugin for Codex and
ChatGPT Work. It does not describe separate Claude, Cursor, AGY, or other dhpk
integrations.

## What the plugin does

The candidate package contains skill instructions and supporting files. It
does not include a DHPK-hosted backend, MCP server, connected app, or lifecycle
hook. Skills guide the host model through software-development workflows. The
host may read or write project files only through the capabilities and
permissions provided by that host and authorized by the user.

## Information and processing

- Prompts and project content supplied to the host may be processed by the
  host's model provider under the account, product, and privacy settings chosen
  by the user. DHPK does not receive that content through a DHPK-operated
  service.
- If the user chooses an optional external provider, CLI, or tool, the relevant
  prompt or file content may be sent to that provider through the user's
  configured account and authorization. The provider's own terms and retention
  controls apply.
- Files read or created by a workflow remain in locations selected by the
  user. The host may also retain conversation history, caches, or local logs
  under its own settings. Some optional dhpk features can write local receipts,
  logs, or artifacts when enabled; the user controls those files and their
  local retention.
- DHPK does not operate a telemetry service for this plugin and does not
  independently send workflow contents or usage events to a DHPK server.

## Recipients and retention

The user's selected host/model provider and any user-configured external
provider or tool may process information as described above. DHPK has no
plugin backend that stores workflow data. Host conversation history, provider
records, local caches, receipts, logs, and project files follow the retention
and deletion controls of the product, provider, or local environment that owns
them; this draft cannot set those periods on their behalf.

If a user opens a support issue at
[GitHub Issues](https://github.com/hmj1026/dhpk/issues), the issue and any
included attachments are handled by GitHub under its
[Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement).
Issues in this public repository may be visible to anyone. Do not include
credentials, personal data, customer information, private source code, or
unredacted logs.

## User controls and contact

Users choose whether to install and invoke the plugin, what prompts and files
to provide, which optional providers or tools to enable, and whether to create
local support artifacts. Review host and provider settings to manage account
history or service-side retention. Delete project files, local logs, and
receipts using the controls of the filesystem or host that stores them.

For non-sensitive product questions, use
[DHPK GitHub Issues](https://github.com/hmj1026/dhpk/issues) and follow
[`docs/support.md`](./support.md). Redact identifying and confidential details
before posting. This draft makes no response-time or service-level commitment.
