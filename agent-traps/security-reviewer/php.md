# security-reviewer — PHP traps

Generic PHP OWASP examples (injection, XSS, CSRF, file upload, deserialization) live at `modules/php-5.6/skills/php-pro/references/agent-extracts/security-owasp-examples.md`.

Universal PHP web traps:

- Unparameterized SQL — string-concatenated query → `:param` PDO binding / prepared statement, never concatenation.
- Unescaped `echo` of user data (reflected / stored XSS) → `htmlspecialchars($x, ENT_QUOTES, 'UTF-8')` on output.
- `unserialize($userData)` on untrusted input (PHP object injection) → `json_decode($userData, true)` + schema validation.
- Command injection — user input in `exec` / `system` / `shell_exec` / `proc_open` / backticks → `escapeshellarg()` per argument, or avoid the shell entirely; allowlist the command.
- Path traversal — user-controlled path into `fopen` / `file_get_contents` / `include` → `realpath()` + assert the result stays under an allowed base dir; reject `..`.
- `eval()` / `assert()` on a string built from input, and dynamic `$$var` / `call_user_func($_GET[...])` → remove; map to an explicit allowlist.
- Weak password crypto — `md5()` / `sha1()` for passwords → `password_hash()` / `password_verify()` (bcrypt/argon2).

## False positives

- `unserialize()` on framework session
- `md5()` for cache key / filename

## Worked example

```php
// BAD — concatenated input (SQL injection)
$db->query("SELECT * FROM users WHERE email = '" . $_GET['email'] . "'");
// GOOD — bound parameter
$stmt = $db->prepare('SELECT * FROM users WHERE email = :email');
$stmt->execute([':email' => $_GET['email']]);
```
