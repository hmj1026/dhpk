# Provider means the model vendor, not the Host's own runtime

Status: accepted

The dispatch catalog modelled `cursor-native` as a Provider alongside
`claude-code`, `codex-cli`, and `agy`, with a placeholder model id
`cursor-default`. That conflicted with this project's own glossary, where a
Host is the client surface and a Provider is the model service: when Cursor
runs Claude Opus 5, the Provider is Anthropic, the Host is Cursor, and `native`
is the Invocation Route. Under #534 the catalog becomes a flat
`Host × Target-Agent × Provider × Model × Route` table, so we redefined
Provider as the real vendor (`anthropic`, `openai`, `google`, `xai`, …),
removed `cursor-native` as a Provider identity, and deleted the
`cursor-default` placeholder row in favour of concrete model ids.

This is what makes "a different-vendor model may still be `native`" expressible
at all: `cursor-agent models` lists 223 ids including `claude-opus-5-thinking-high`
and `gpt-5.6-sol-high`, and `agy models` lists `claude-opus-4-6-thinking`. Under
the old shape those rows had no truthful spelling, and every cross-vendor call
would have been mislabelled as `headless-cli`.

## Considered Options

- Keep `cursor-native` as a Provider and document it as a special case.
  Rejected: it makes Route inferable from the Provider name, which is exactly
  the inference #534 forbids, and it leaves Cursor's real vendor rows
  unrepresentable.
- Introduce a separate "host runtime" dimension beside Provider. Rejected: the
  Route field already carries that fact; a fourth naming axis would be a second
  source of truth for the same distinction.

## Consequences

- Breaking for user configuration: `cursor-native/...` and the `native/...`
  alias are no longer valid targets. They are translated at the input boundary
  with a deprecation diagnostic and removed in the next minor; `cursor-default`
  has no concrete successor id and translates to the Host/Role worker default.
- The catalog schema moves to `dhpk.model.catalog.v2` with a separate
  `models{}` block, so vendor-level facts (display name, pricing) are stated
  once rather than once per Host.
