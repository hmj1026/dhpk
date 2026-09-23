# Harness audit workflow

1. Parse `[scope] [--format text|json] [--root <path>]`. Scope defaults to
   `repo` and must be one of `repo`, `hooks`, `skills`, `commands`, or
   `agents`. Format defaults to `text` and must be `text` or `json`. Preserve
   the exact root path when supplied.
2. Resolve `$SKILL_DIR` to the installed package directory and run from the
   consumer repository cwd:

   ```bash
   node "$SKILL_DIR/scripts/harness-audit.js" <scope> --format <text|json> [--root <path>]
   ```

   Do not substitute a project-local script or a hand-written audit.
3. Treat the deterministic engine and rubric `2026-03-30` as authoritative.
   It computes Tool Coverage, Context Efficiency, Quality Gates, Memory
   Persistence, Eval Coverage, Security Guardrails, and Cost Efficiency; each
   category is normalized `0-10`, with `70` as the `repo` maximum.
4. For JSON, return the script JSON unchanged. For text, preserve the overall
   score, category scores, concrete findings, exact `checks[]` paths, the top
   three `top_actions[]`, and suggested next skills. Do not rescore or add
   dimensions.
5. A missing package-local engine is `UNAVAILABLE`; a non-zero exit, malformed
   output, or invalid arguments is `FAIL`. Completion requires the script exit
   status and the requested format's complete output evidence.
