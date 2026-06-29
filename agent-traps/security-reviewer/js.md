# security-reviewer — JS / TypeScript traps

OWASP lanes for `.ts/.tsx/.js/.jsx` (Node + browser). Code-quality / floating-promise
lanes live in `code-reviewer/js.md`; ESLint-tier / AJAX-facade in `frontend-reviewer`.
This sheet owns the *security* baseline that `code-reviewer/js.md` defers here.
Diagnostics: `npm audit --audit-level=high` · `eslint . --plugin security`.

Universal JS web traps:

- XSS — `el.innerHTML = userInput`, `dangerouslySetInnerHTML`, `$(el).html(input)`, `document.write(input)` → `textContent` / framework escaping; sanitize rich HTML with DOMPurify before render.
- SQL / NoSQL injection — template-string or concatenated query (`` `... ${id}` ``), Mongo `$where` / `find(JSON.parse(input))` → parameterized query / prepared statement; never interpolate input into the query.
- Command injection — user input in `child_process.exec` / `execSync` / `` `sh -c …` `` → `execFile` / `spawn` with an argument array; allowlist the binary, never shell-interpolate.
- SSRF — `fetch(userUrl)` / `axios.get(userUrl)` to a user-controlled host → allowlist scheme + host; block link-local / metadata IPs (`169.254.169.254`, RFC1918).
- Secrets in code — hardcoded API keys, tokens, connection strings → `process.env.X`, validated at startup; rotate anything already committed. Never ship secrets to the client bundle.
- Insecure deserialization / prototype pollution — `lodash.merge` / `Object.assign` of untrusted JSON, `JSON.parse` spread into a config object → reject `__proto__` / `constructor` keys, use a schema (zod/joi) or `Map`.
- Code execution — `eval(input)`, `new Function(input)`, `setTimeout(stringFromInput, …)` → remove; map to an explicit allowlist of behaviors.
- Weak auth tokens — JWT created/verified without `expiresIn` / signature check, `alg: none` accepted; session cookies missing `httpOnly` / `Secure` / `SameSite` → set all three; verify signature + expiry server-side.
- Missing authorization — a route that mutates or returns data without an authn middleware or an ownership check → compare the resource owner against the authenticated principal (the most common real hole).
- Missing rate limiting — auth / write endpoints with no throttle → `express-rate-limit` (or equivalent) on state-changing + login routes.

## False positives

- `JSON.parse` of a server-side trusted constant (no external input)
- `Math.random()` for jitter / sampling (non-crypto) — only flag in token / id / nonce generation
- `dangerouslySetInnerHTML` fed an already-DOMPurify-sanitized value
- Public/publishable keys intended for the client (e.g. a publishable API key), and `.env.example` placeholders

Before reporting: *what attack does this enable?* No path → don't report.

## Worked example

```ts
// BAD — user host reaches fetch (SSRF); raw HTML reaches the DOM (XSS)
const r = await fetch(req.query.url as string)
el.innerHTML = await r.text()

// GOOD — allowlist the host, escape the output
const url = new URL(req.query.url as string)
if (!ALLOWED_HOSTS.has(url.host)) throw new Error('host not allowed')
const r = await fetch(url)
el.textContent = await r.text()        // or DOMPurify.sanitize(...) for rich HTML
```

```ts
// BAD — shell interpolation (command injection)
exec(`convert ${req.body.file} out.png`)
// GOOD — argument array, no shell
execFile('convert', [req.body.file, 'out.png'])
```
