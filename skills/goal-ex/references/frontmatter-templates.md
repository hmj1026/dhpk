# Frontmatter Templates (skill / agent / rule)

Loaded by `goal-ex` Phase 4. Required frontmatter fields + required-section lists per product type.

---

## A. .claude/skills/<name>/SKILL.md

### Frontmatter (required)

```yaml
---
name: <kebab-case-slug>                              # required, must match directory name
description: '<one-line>. Use when: ... Not for: ... Output: ...'
allowed-tools: 'Read, Grep, Glob, Edit, Write, Bash'  # required, comma-separated; restrict strictly
disable-model-invocation: true                       # optional; set when explicit /<name> trigger is required
---
```

### 7 required sections (default shape for a domain skill)

1. When to use / When NOT to use (include Alternative column)
2. Workflow (step list or ASCII flow diagram)
3. Key files (list of key files that must be read first)
4. Reusable modules (existing helper / service / trait already in the project)
5. Common commands (actually-runnable commands, including `docker exec` form if applicable)
6. Anti-patterns / Hard limits (forbidden items, marked **Hard rule**)
7. Verification checklist (`- [ ]` format)

### Exception: meta-skill custom structure

Meta-workflow skills (e.g. `goal-ex` itself, `harness-revise`, `bug-investigation`) may use a phase-based structure instead of the 7 sections. Criteria:

- The skill itself is a "teach AI to run an N-phase workflow" methodology (not a "describe domain hard rules" reference)
- Phases have strong sequential dependency
- Each phase internally covers Key files / Common commands / Anti-patterns equivalents

Must retain regardless: When to use / When NOT to use, Anti-patterns / Hard limits, Verification checklist (jointly "the inviolable three").

### Length limit

150–250 lines. Over-limit means scope too large; must split the skill or extract references subfiles.

---

## B. .claude/agents/<name>.md

### Frontmatter (required)

```yaml
---
name: <kebab-case>
description: >-
  <one paragraph: role positioning + trigger conditions + scope carve-out (which scenarios do NOT activate) + when to skip>
tools: ["Read", "Grep", "Glob"]   # reviewers: do NOT include Edit/Write; developer-type can include Edit/Write/Bash
model: haiku                       # haiku (frequent lightweight reviews) / sonnet (main dev) / opus (architecture decisions)
---
```

### Required sections

- Scope carve-out (the judge-then-activate decision table)
- Process (step list)
- Checklist (`- [ ]` format)
- Output format (artifact output path and frontmatter format)
- Closing hook (sentinel clear command: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh <name> <label>` — or the project's own equivalent path if not dhpk-installed)

### Length limit

60–143 lines.

### After adding an agent, must sync

1. `.claude/agents/INDEX.md`: add row to the Mandatory Chain or Situational table
2. Execution-policy rule (project's own or cross-ref to `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`): Agent dispatch table → add trigger; if it has a sentinel, add a Mandatory post-steps entry
3. Post-edit hook: if the agent is sentinel-triggered, add path pattern → sentinel mapping

---

## C. .claude/rules/<topic>.md

### Format

No frontmatter, pure Markdown.

### Required

- **Hard rule** (marked **MUST / forbidden**)
- **Scope rule** (avoid meaningless sweeps)
  > Example: "Newly-added / modified diff → MUST; other existing methods → do NOT actively clean up (let the fixer unify them when they're naturally committed)"
- Cross-reference via relative paths (`../execution-policy.md` or `.claude/rules/...`); when cross-referencing dhpk shipped rules, use `${CLAUDE_PLUGIN_ROOT}/rules/...`

### Length limit

60–124 lines.

---

## D. Per-layer CLAUDE.md

### Format

No frontmatter, pure Markdown.

### Required

- Title: `# CLAUDE.md (<layer>)`
- Opening: `Local rules for <path>/`; cross-reference root
- Purpose (this layer's responsibility boundary)
- Read this when (scenarios)
- Local truths (naming / directory / pattern / data flow / anti-patterns)
- Avoid / Escalate (forbidden content / escalation notice)
- Related files (cross-reference other layers + key rules)

### Length limit

~40 lines. Over-limit means content should be extracted into a rule or skill.

---

## E. Root CLAUDE.md required sections (in order)

1. Project intro (one sentence + primary tech stack with version constraints)
2. Rule priority (System → User → CLAUDE.md → `.claude/rules/*.md` → load-on-demand docs)
3. Communication (reply language / code comment language / domain terms)
4. Core rules: SSOT / Read-before-write (cx > gitnexus > Read) / No auto-commit / language version constraints
5. Key references table (Topic → File) at minimum including:
   - Execution strategy + sentinel review gates → `.claude/rules/execution-policy.md` (or `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` if dhpk-installed)
   - Tool routing → `.claude/rules/tool-routing.md`
   - Sub-agent prompt template → `.claude/docs/subagent-prompt-template.md` (or dhpk's `${CLAUDE_PLUGIN_ROOT}/docs/subagent-prompt-template.md`)
   - Agent roster → `.claude/agents/INDEX.md`
   - MCP server inventory → `.claude/docs/mcp-servers.md` (if present)
   - Language / framework patterns → `.claude/rules/<lang>/<topic>.md`
   - Frontend rules → `.claude/rules/frontend.md` (if frontend exists)
   - Layer governance → each layer's CLAUDE.md
6. Settings split (`settings.json` shared / `settings.local.json` gitignored / `.harness-profile` optional)
7. (Optional) GitNexus section (if code index has been built)
