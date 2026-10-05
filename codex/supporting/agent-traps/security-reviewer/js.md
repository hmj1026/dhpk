# JavaScript Security Traps

Trace each finding from a concrete source through the changed path to a sensitive sink. For prompt or instruction injection, route to the shared [prompt-defense owner](../_common/prompt-defense.md); this sheet covers code and data trust boundaries.

## DOM injection

**Trigger → evidence/action:** Attacker-controlled or otherwise untrusted data reaches an HTML, script, event-handler, or executable URL context, including `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `Function`, or a framework escape hatch such as Vue `v-html`. Trace source, transformations, and sink; prefer safe text/DOM APIs or a context-appropriate maintained sanitizer, then test hostile values. See OWASP’s [DOM XSS](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html) and [XSS prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) guidance.

**Do not apply when:** The value is a fixed trusted constant or safe text is assigned through a non-parsing sink. A sanitizer is relevant only when its policy and call site actually cover the data and output context.

## Query and command trust paths

**Trigger → evidence/action:** Request, file, message, or environment data influences a database query, raw query fragment, operator or identifier, shell command, or executable argument. Trace the exact source-to-sink path. Bind data values; allowlist dynamic identifiers and operators; pass executable arguments separately with shell interpretation disabled where supported. Review authorization independently from injection. Node documents the shell behavior and input risk of [`child_process.exec`](https://nodejs.org/api/child_process.html); OWASP provides [JavaScript and TypeScript security guidance](https://cheatsheetseries.owasp.org/cheatsheets/JavaScript_and_TypeScript_Security_Cheat_Sheet.html).

**Do not apply when:** The relevant query or command uses trusted constants and verifiable parameter binding or argument separation. A query builder’s presence alone does not establish safety.

## Server-side request forgery

**Trigger → evidence/action:** Server-side code fetches a URL influenced by a user, stored record, callback, or redirect. Trace parsing, scheme and host policy, DNS resolution, redirects, and destination checks; restrict targets to the required hosts or address ranges and test redirects and private-address cases. See OWASP’s [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

**Do not apply when:** The request target is a fixed trusted server-side constant and callers cannot alter it. Browser-side fetch is not SSRF; assess its separate browser and authorization risks.

## Object keys and prototype behavior

**Trigger → evidence/action:** Untrusted keys are merged into objects, used in deep-merge helpers, or traversed as property paths. Check handling of `__proto__`, `constructor`, and `prototype`, and test hostile nested keys through downstream use. Prefer a safe map or explicit own-key allowlist. See OWASP’s [Prototype Pollution Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html).

**Do not apply when:** Keys are constrained by a proven allowlist or stored in a data structure that does not mutate object prototypes. Confirm the actual merge semantics before reporting.

## JWT and session lifecycle

**Trigger → evidence/action:** Code issues, accepts, refreshes, or invalidates JWTs or sessions. Verify the configured signature algorithm and key, issuer, audience, time claims, and the session model’s rotation, expiry, logout, and revocation behavior. Check cookie attributes where cookies carry session credentials. Use the project’s actual authentication contract; see OWASP’s [JWT](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) and [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) guidance.

**Do not apply when:** The value is merely decoded for display and is never trusted for authentication or authorization. Decoding alone does not establish validity.

## Object ownership

**Trigger → evidence/action:** A request selects a record, tenant, account, or export by client-controlled identifier. Follow the identifier to a server-side authorization decision bound to the authenticated principal and test cross-owner access for each affected read or write path.

**Do not apply when:** The resource is intentionally public or the operation has a documented system-wide authorization path. Client-side filtering alone is not evidence of server-side ownership enforcement.

## Client-visible credentials

**Trigger → evidence/action:** A private credential or privileged token is embedded in a browser bundle, source map, storage, or client configuration. Confirm that the value is secret-bearing and usable from an untrusted client; move privileged credentials server-side and rotate exposed secrets.

**Do not apply when:** The value is intentionally public, such as a public verification key, OAuth client identifier, endpoint, or immutable trusted constant. Verify its intended privilege and mutability before calling it a secret.
