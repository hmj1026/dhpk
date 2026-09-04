# Budget mode

Budget measures harness context cost. It reports observed counts separately
from estimates and ranks changes; it does not delete components or edit rules.

## Invocation

```text
$harness-govern budget [--verbose] [--dry-run]
```

`--dry-run` is accepted as an explicit no-write declaration. Resolve the active
harness through `harness-directory-contract.md` before scanning.

## Procedure

1. Detect the actual model and context window first. A `[1m]` model or Opus /
   Sonnet 4.x uses 1,000,000 tokens; Haiku and legacy models use 200,000.
2. Inventory agents, skills, rules, MCP servers/tools, and the CLAUDE.md chain.
   Count observed lines/files; estimate prose as words × 1.3 and code-heavy
   files as characters ÷ 4. Do not count identical consumer copies twice.
3. Classify components as always needed, sometimes needed, or rarely needed.
   Flag oversized descriptions/files, duplicate rules or skills, MCP servers
   that wrap available CLI commands, and an oversized CLAUDE.md chain.
4. Run the tier-economics pass over agent frontmatter. A read-only discovery
   role on opus, a mechanical writer at high effort, or an expensive
   high-frequency reviewer is a cost-posture mismatch. Reasoning roles are not
   discovery roles merely because their tools are read-only.
5. Rank savings and state the measurement assumptions. A recommendation is
   text only; any removal or rewrite is a separate approved mode.

## Output contract

```markdown
Context Budget Report

- Context model: <id>; window: <200K|1M>
- Observed overhead: ~<tokens>; effective available context: ~<tokens> (<%>)

| Component | Count | Observed/estimated tokens |
|-----------|-------|--------------------------|
| Agents / Skills / Rules / MCP / CLAUDE.md | ... | ... |

### Ranked issues
1. <action> → save ~<tokens>

### Tier economics
| Role | model | effort | posture |
|------|-------|--------|---------|
| ... | ... | ... | OK/MISMATCH |

Tier economics: <N> roles OK, <M> mismatches
Gate: PASS / BLOCKED / NOT_RUN
```

Always include model/window, all five buckets, top three savings when present,
tier verdict, and assumptions. In `--verbose`, include per-file counts and
the overlap/tool evidence supporting each recommendation.

## Completion

Budget is complete when all buckets were scanned or explicitly marked
unavailable, the effective percentage uses the detected window, observations
are separated from estimates, savings are quantified, and the report contains
one next action. Do not turn a budget recommendation into an applied change.
