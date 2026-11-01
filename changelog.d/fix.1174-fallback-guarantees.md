scope: dispatch
note: `decideFallback` now enforces the documented fallback guarantees: a failed target is never revisited, one shared `retry_budget` is carried on the returned request, and `QUOTA_OR_RATE_LIMIT` selects a different quota pool only with `fallback.cross_provider` opt-in (new optional `cross_provider`, `attempted_backends`, `unavailable_backends` request fields).
