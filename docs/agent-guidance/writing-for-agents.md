# Writing-for-Agents Contract

Use this page when editing any skill, agent, rule, command, trap sheet,
`AGENTS.md`, or `CLAUDE.md`. It is a compact repository contract; detailed
skill mechanics remain in the external `writing-for-agents` 1.2.x reference
and the owning files. The pinned apply source is `/home/paul/projects/matt-pocock_skills`
(`package.json` 1.2.3); the public mirror is
`https://github.com/mattpocock/skills/tree/main/skills/productivity/writing-for-agents`.
Do not vendor that upstream skill into this repository.

## Five checks

1. **Pointer** — state the trigger and the nearest non-use boundary before
   pointing to detailed mechanics.
2. **Hierarchy** — keep the primary path in the document, disclose branch-only
   mechanics behind a co-located reference, and keep each meaning in one SSOT.
3. **Completion** — state observable verification, the handoff state, and the
   boundary between a plan, an applied change, and an archived change.
4. **Pruning** — delete no-op, duplicate, stale, or environment-cache prose;
   prefer the repository command/config as the source when it is authoritative.
5. **Boundary** — preserve invocation class, route target, agent/tool/model
   boundary, rule precedence, command flags, and Claude/Codex support tier.

## Document-class contract

- Skills: frontmatter pointer, non-use boundary, output, verification, and
  resolvable reference/handoff.
- Agents: role scope, tools/model entitlement, completion evidence, and
  escalation or next-role handoff.
- Rules: owning SSOT, precedence, decision trigger, and a pointer outward
  rather than a duplicated implementation policy.
- Commands: invocation/route, accepted arguments, failure boundary, and
  observable output or exit contract.
- Root guidance: universal constraints plus links to the topic document; keep
  `AGENTS.md` and `CLAUDE.md` under 50 lines and keep Codex-specific details in
  `codex/AGENTS.md`.
- Trap sheets: unique agent×stack traps in `agent-traps/<agent>/<stack>.md`;
  shared loader, prompt-defense, build-resolver skeleton, and CLI prompt
  composition live only in `agent-traps/_common/`; every canonical file needs a
  disposition in [trap-sheet-disposition.md](trap-sheet-disposition.md). Do not
  restate per-stack traps here.

Run Markdownlint, the strict frontmatter/invocation validators, route and
distribution checks, and the focused contract test before claiming completion.
