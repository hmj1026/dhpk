# PHP security review traps

Use configured project instructions, PHP runtime and extension support, and the Laravel or other framework version where relevant. This sheet is host-neutral. The `php-7.4` route selects this sheet; use the actual configured runtime floor. For paths explicitly required to support PHP 5.6, verify that proposed APIs exist there instead of assuming modern invocation forms. Yii-specific controller, access-rule, and lifecycle behavior belongs to the dedicated Yii guidance.

## SQL construction

**Trigger:** Request or other untrusted values reach SQL text or execution.

**Check and act:** Trace values through the query builder or driver. Verify bound parameters for values and an explicit allowlist for dynamic identifiers or fragments. PHP’s PDO documentation explains that prepared-statement parameters are handled by the driver, while unbound string-built portions need separate review. [PDO prepared statements](https://www.php.net/manual/en/pdo.prepared-statements.php)

**Do not apply when:** The SQL and all its values are fixed and trusted. Do not report string syntax alone without an input-to-execution path.

## Output encoding

**Trigger:** External or stored data is emitted into HTML, an attribute, a URL, JavaScript, or another output format.

**Check and act:** Identify the exact output context and verify encoding for that context. htmlspecialchars() handles a defined set of HTML special characters; it is not a universal encoder for every output context. Confirm flags and character encoding against the project runtime. [PHP htmlspecialchars](https://www.php.net/manual/en/function.htmlspecialchars.php)

**Do not apply when:** Data is not rendered or is already encoded at the correct boundary. Avoid both unencoded output and repeated encoding without tracing the data.

## Filesystem and shell boundaries

**Trigger:** Request fields, uploads, archive names, or configuration values reach include, filesystem writes/deletes, or shell execution.

**Check and act:** Follow the value to the target operation. Verify the resolved target is within the intended directory, the caller has authority for that operation, and shell arguments cannot alter the intended command. Check the APIs against PHP 5.6 when that legacy runtime applies; do not recommend newer invocation forms without version evidence.

**Do not apply when:** The path and operation are fixed by trusted code and cannot be influenced by the request. Do not treat an extension or basename check alone as proof of containment.

## Deserialization

**Trigger:** Serialized data from a request, cache, file, or external service is passed to unserialize().

**Check and act:** Establish the origin and integrity of the payload. PHP warns against passing untrusted input to unserialize() because object creation and autoloading can load or execute code; prefer a safe data format when the contract permits it. [PHP unserialize](https://www.php.net/manual/en/function.unserialize.php)

**Do not apply when:** The payload is not deserialized or is demonstrably inside a trusted, integrity-protected boundary.

## Secrets, passwords, tokens, and cryptography

**Trigger:** Credentials or cryptographic values are created, stored, transported, verified, logged, or returned.

**Check and act:** Identify each value’s purpose and runtime path. Confirm passwords use the configured runtime’s password-hash and verification APIs; PHP documents password_verify() specifically for checking a password against a hash. For tokens, verify the application’s required issuer, recipient, scope, expiry, and revocation behavior. For encryption or signing changes, verify the algorithm and extension against the configured PHP floor instead of proposing primitives from memory. [PHP password_verify](https://www.php.net/manual/en/function.password-verify.php)

**Do not apply when:** The value is public and has no credential role. Do not treat a valid signature as authorization for every action, or treat password hashes as general-purpose tokens.

## CSRF and framework boundaries

**Trigger:** A finding alleges missing CSRF protection or relies on Yii-specific behavior.

**Check and act:** For CSRF, establish that the request changes state and that the browser automatically attaches an ambient credential, such as a cookie, HTTP authentication, or another automatically supplied browser credential. Verify the configured protection contract and establish missing or bypassable protection before reporting. Do not impose a blanket CSRF requirement on every API or webhook. For Yii 1.x controller, access-rule, or lifecycle claims, use the dedicated Yii guidance; this sheet covers PHP-level sinks and runtime compatibility.

**Do not apply when:** The route has no ambient browser credential context, or the concern requires framework behavior outside this sheet’s scope. For model prompt or tool-boundary issues, use the shared [prompt-defense guidance](../_common/prompt-defense.md).
