# Skill Judge — Full Scoring Rubric (120 points)

Self-contained scoring reference for `skill-judge`. Load this when scoring a skill across the 8 dimensions, assigning points, or computing the grade. Each dimension lists score bands, green/red flags, examples, and the evaluation test to apply.

Total = D1 + D2 + D3 + D4 + D5 + D6 + D7 + D8 = **120 points max**.

---

## D1: Knowledge Delta (20 points) — THE CORE DIMENSION

The most important dimension. Does the Skill add genuine expert knowledge?

| Score | Criteria |
|-------|----------|
| 0-5 | Explains basics Claude knows (what is X, how to write code, standard library tutorials) |
| 6-10 | Mixed: some expert knowledge diluted by obvious content |
| 11-15 | Mostly expert knowledge with minimal redundancy |
| 16-20 | Pure knowledge delta — every paragraph earns its tokens |

**Red flags** (instant score ≤5):
- "What is [basic concept]" sections
- Step-by-step tutorials for standard operations
- Explaining how to use common libraries
- Generic best practices ("write clean code", "handle errors")
- Definitions of industry-standard terms

**Green flags** (indicators of high knowledge delta):
- Decision trees for non-obvious choices ("when X fails, try Y because Z")
- Trade-offs only an expert would know ("A is faster but B handles edge case C")
- Edge cases from real-world experience
- "NEVER do X because [non-obvious reason]"
- Domain-specific thinking frameworks

**Evaluation questions**:
1. For each section, ask: "Does Claude already know this?"
2. If explaining something, ask: "Is this explaining TO Claude or FOR Claude?"
3. Count paragraphs that are Expert vs Activation vs Redundant

---

## D2: Mindset + Appropriate Procedures (15 points)

Does the Skill transfer expert **thinking patterns** along with **necessary domain-specific procedures**?

The difference between experts and novices isn't "knowing how to operate" — it's "how to think about the problem." But thinking patterns alone aren't enough when Claude lacks domain-specific procedural knowledge.

**Key distinction**:
| Type | Example | Value |
|------|---------|-------|
| **Thinking patterns** | "Before designing, ask: What makes this memorable?" | High — shapes decision-making |
| **Domain-specific procedures** | "OOXML workflow: unpack → edit XML → validate → pack" | High — Claude may not know this |
| **Generic procedures** | "Step 1: Open file, Step 2: Edit, Step 3: Save" | Low — Claude already knows |

| Score | Criteria |
|-------|----------|
| 0-3 | Only generic procedures Claude already knows |
| 4-7 | Has domain procedures but lacks thinking frameworks |
| 8-11 | Good balance: thinking patterns + domain-specific workflows |
| 12-15 | Expert-level: shapes thinking AND provides procedures Claude wouldn't know |

**What counts as valuable procedures**:
- Workflows Claude hasn't been trained on (new tools, proprietary systems)
- Correct ordering that's non-obvious (e.g., "validate BEFORE packing, not after")
- Critical steps that are easy to miss (e.g., "MUST recalculate formulas after editing")
- Domain-specific sequences (e.g., MCP server's 4-phase development process)

**What counts as redundant procedures**:
- Generic file operations (open, read, write, save)
- Standard programming patterns (loops, conditionals, error handling)
- Common library usage that's well-documented

**Expert thinking patterns look like**:
```markdown
Before [action], ask yourself:
- **Purpose**: What problem does this solve? Who uses it?
- **Constraints**: What are the hidden requirements?
- **Differentiation**: What makes this solution memorable?
```

**Valuable domain procedures look like**:
```markdown
### Redlining Workflow (Claude wouldn't know this sequence)
1. Convert to markdown: `pandoc --track-changes=all`
2. Map text to XML: grep for text in document.xml
3. Implement changes in batches of 3-10
4. Pack and verify: check ALL changes were applied
```

**Redundant generic procedures look like**:
```markdown
Step 1: Open the file
Step 2: Find the section
Step 3: Make the change
Step 4: Save and test
```

**The test**:
1. Does it tell Claude WHAT to think about? (thinking patterns)
2. Does it tell Claude HOW to do things it wouldn't know? (domain procedures)

A good Skill provides both when needed.

---

## D3: Anti-Pattern Quality (15 points)

Does the Skill have effective NEVER lists?

**Why this matters**: Half of expert knowledge is knowing what NOT to do. A senior designer sees purple gradient on white background and instinctively cringes — "too AI-generated." This intuition for "what absolutely not to do" comes from stepping on countless landmines.

Claude hasn't stepped on these landmines. It doesn't know Inter font is overused, doesn't know purple gradients are the signature of AI-generated content. Good Skills must explicitly state these "absolute don'ts."

| Score | Criteria |
|-------|----------|
| 0-3 | No anti-patterns mentioned |
| 4-7 | Generic warnings ("avoid errors", "be careful", "consider edge cases") |
| 8-11 | Specific NEVER list with some reasoning |
| 12-15 | Expert-grade anti-patterns with WHY — things only experience teaches |

**Expert anti-patterns** (specific + reason):
```markdown
NEVER use generic AI-generated aesthetics like:
- Overused font families (Inter, Roboto, Arial)
- Cliched color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Default border-radius on everything
```

**Weak anti-patterns** (vague, no reasoning):
```markdown
Avoid making mistakes.
Be careful with edge cases.
Don't write bad code.
```

**The test**: Would an expert read the anti-pattern list and say "yes, I learned this the hard way"? Or would they say "this is obvious to everyone"?

---

## D4: Specification Compliance — Especially Description (15 points)

Does the Skill follow official format requirements? **Special focus on description quality.**

| Score | Criteria |
|-------|----------|
| 0-5 | Missing frontmatter or invalid format |
| 6-10 | Has frontmatter but description is vague or incomplete |
| 11-13 | Valid frontmatter, description has WHAT but weak on WHEN |
| 14-15 | Perfect: comprehensive description with WHAT, WHEN, and trigger keywords |

**Frontmatter requirements**:
- `name`: lowercase, alphanumeric + hyphens only, ≤64 characters
- `description`: **THE MOST CRITICAL FIELD** — determines if skill gets used at all

**Why description is THE MOST IMPORTANT field**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  SKILL ACTIVATION FLOW                                              │
│                                                                     │
│  User Request → Agent sees ALL skill descriptions → Decides which  │
│                 (only descriptions, not bodies!)     to activate    │
│                                                                     │
│  If description doesn't match → Skill NEVER gets loaded            │
│  If description is vague → Skill might not trigger when it should  │
│  If description lacks keywords → Skill is invisible to the Agent   │
└─────────────────────────────────────────────────────────────────────┘
```

**The brutal truth**: A Skill with perfect content but poor description is **useless** — it will never be activated. The description is the **only chance** to tell the Agent "use me in these situations."

**Description must answer THREE questions**:

1. **WHAT**: What does this Skill do? (functionality)
2. **WHEN**: In what situations should it be used? (trigger scenarios)
3. **KEYWORDS**: What terms should trigger this Skill? (searchable terms)

**Excellent description** (all three elements):
```yaml
description: "Comprehensive document creation, editing, and analysis with support
for tracked changes, comments, formatting preservation, and text extraction.
When Claude needs to work with professional documents (.docx files) for:
(1) Creating new documents, (2) Modifying or editing content,
(3) Working with tracked changes, (4) Adding comments, or any other document tasks"
```

Analysis:
- WHAT: creation, editing, analysis, tracked changes, comments
- WHEN: "When Claude needs to work with... for: (1)... (2)... (3)..."
- KEYWORDS: .docx files, tracked changes, professional documents

**Poor description** (missing elements):
```yaml
description: "处理文档相关功能"
```

Problems:
- WHAT: vague ("文档相关功能" — what specifically?)
- WHEN: missing (when should Agent use this?)
- KEYWORDS: missing (no ".docx", no specific scenarios)

**Another poor example**:
```yaml
description: "A helpful skill for various tasks"
```

This is useless — Agent has no idea when to activate it.

**Description quality checklist**:
- [ ] Lists specific capabilities (not just "helps with X")
- [ ] Includes explicit trigger scenarios ("Use when...", "When user asks for...")
- [ ] Contains searchable keywords (file extensions, domain terms, action verbs)
- [ ] Specific enough that Agent knows EXACTLY when to use it
- [ ] Includes scenarios where this skill MUST be used (not just "can be used")

---

## D5: Progressive Disclosure (15 points)

Does the Skill implement proper content layering?

Skill loading has three layers:
```
Layer 1: Metadata (always in memory)
         Only name + description
         ~100 tokens per skill

Layer 2: SKILL.md Body (loaded after triggering)
         Detailed guidelines, code examples, decision trees
         Ideal: < 500 lines

Layer 3: Resources (loaded on demand)
         scripts/, references/, assets/
         No limit
```

| Score | Criteria |
|-------|----------|
| 0-5 | Everything dumped in SKILL.md (>500 lines, no structure) |
| 6-10 | Has references but unclear when to load them |
| 11-13 | Good layering with MANDATORY triggers present |
| 14-15 | Perfect: decision trees + explicit triggers + "Do NOT Load" guidance |

**For Skills WITH references directory**, check Loading Trigger Quality:

| Trigger Quality | Characteristics |
|-----------------|-----------------|
| Poor | References listed at end, no loading guidance |
| Mediocre | Some triggers but not embedded in workflow |
| Good | MANDATORY triggers in workflow steps |
| Excellent | Scenario detection + conditional triggers + "Do NOT Load" |

**The loading problem**:
```
Loading too little ◄─────────────────────────────────► Loading too much
- References sit unused                    - Wastes context space
- Agent doesn't know when to load          - Irrelevant info dilutes key content
- Knowledge is there but never accessed    - Unnecessary token overhead
```

**Good loading trigger** (embedded in workflow):
```markdown
### Creating New Document

**MANDATORY - READ ENTIRE FILE**: Before proceeding, you MUST read
[`docx-js.md`](docx-js.md) (~500 lines) completely from start to finish.
**NEVER set any range limits when reading this file.**

**Do NOT load** `ooxml.md` or `redlining.md` for this task.
```

**Bad loading trigger** (just listed):
```markdown
## References
- docx-js.md - for creating documents
- ooxml.md - for editing
- redlining.md - for tracking changes
```

**For simple Skills** (no references, <100 lines): Score based on conciseness and self-containment.

---

## D6: Freedom Calibration (15 points)

Is the level of specificity appropriate for the task's fragility?

Different tasks need different levels of constraint. This is about matching freedom to fragility.

| Score | Criteria |
|-------|----------|
| 0-5 | Severely mismatched (rigid scripts for creative tasks, vague for fragile ops) |
| 6-10 | Partially appropriate, some mismatches |
| 11-13 | Good calibration for most scenarios |
| 14-15 | Perfect freedom calibration throughout |

**The freedom spectrum**:

| Task Type | Should Have | Why | Example Skill |
|-----------|-------------|-----|---------------|
| Creative/Design | High freedom | Multiple valid approaches, differentiation is value | frontend-design |
| Code review | Medium freedom | Principles exist but judgment required | code-review |
| File format operations | Low freedom | One wrong byte corrupts file, consistency critical | docx, xlsx, pdf |

**High freedom** (text-based instructions):
```markdown
Commit to a BOLD aesthetic direction. Pick an extreme: brutally minimal,
maximalist chaos, retro-futuristic, organic natural...
```

**Medium freedom** (pseudocode or parameterized):
```markdown
Review priority:
1. Security vulnerabilities (must fix)
2. Logic errors (must fix)
3. Performance issues (should fix)
4. Maintainability (optional)
```

**Low freedom** (specific scripts, exact steps):
```markdown
**MANDATORY**: Use exact script in `scripts/create-doc.py`
Parameters: --title "X" --author "Y"
Do NOT modify the script.
```

**The test**: Ask "if Agent makes a mistake, what's the consequence?"
- High consequence → Low freedom
- Low consequence → High freedom

---

## D7: Pattern Recognition (10 points)

Does the Skill follow an established official pattern?

Through analyzing 17 official Skills, we identified 5 main design patterns:

| Pattern | ~Lines | Key Characteristics | Example | When to Use |
|---------|--------|---------------------|---------|-------------|
| **Mindset** | ~50 | Thinking > technique, strong NEVER list, high freedom | frontend-design | Creative tasks requiring taste |
| **Navigation** | ~30 | Minimal SKILL.md, routes to sub-files | internal-comms | Multiple distinct scenarios |
| **Philosophy** | ~150 | Two-step: Philosophy → Express, emphasizes craft | canvas-design | Art/creation requiring originality |
| **Process** | ~200 | Phased workflow, checkpoints, medium freedom | mcp-builder | Complex multi-step projects |
| **Tool** | ~300 | Decision trees, code examples, low freedom | docx, pdf, xlsx | Precise operations on specific formats |

| Score | Criteria |
|-------|----------|
| 0-3 | No recognizable pattern, chaotic structure |
| 4-6 | Partially follows a pattern with significant deviations |
| 7-8 | Clear pattern with minor deviations |
| 9-10 | Masterful application of appropriate pattern |

**Pattern selection guide**:

| Your Task Characteristics | Recommended Pattern |
|---------------------------|---------------------|
| Needs taste and creativity | Mindset (~50 lines) |
| Needs originality and craft quality | Philosophy (~150 lines) |
| Has multiple distinct sub-scenarios | Navigation (~30 lines) |
| Complex multi-step project | Process (~200 lines) |
| Precise operations on specific format | Tool (~300 lines) |

---

## D8: Practical Usability (15 points)

Can an Agent actually use this Skill effectively?

| Score | Criteria |
|-------|----------|
| 0-5 | Confusing, incomplete, contradictory, or untested guidance |
| 6-10 | Usable but with noticeable gaps |
| 11-13 | Clear guidance for common cases |
| 14-15 | Comprehensive coverage including edge cases and error handling |

**Check for**:
- **Decision trees**: For multi-path scenarios, is there clear guidance on which path to take?
- **Code examples**: Do they actually work? Or are they pseudocode that breaks?
- **Error handling**: What if the main approach fails? Are fallbacks provided?
- **Edge cases**: Are unusual but realistic scenarios covered?
- **Actionability**: Can Agent immediately act, or needs to figure things out?

**Good usability** (decision tree + fallback):
```markdown
| Task | Primary Tool | Fallback | When to Use Fallback |
|------|-------------|----------|----------------------|
| Read text | pdftotext | PyMuPDF | Need layout info |
| Extract tables | camelot-py | tabula-py | camelot fails |

**Common issues**:
- Scanned PDF: pdftotext returns blank → Use OCR first
- Encrypted PDF: Permission error → Use PyMuPDF with password
```

**Poor usability** (vague):
```markdown
Use appropriate tools for PDF processing.
Handle errors properly.
Consider edge cases.
```

---

## Total & Grade

```
Total = D1 + D2 + D3 + D4 + D5 + D6 + D7 + D8
Max = 120 points
```

**Grade Scale** (percentage-based):
| Grade | Percentage | Meaning |
|-------|------------|---------|
| A | 90%+ (108+) | Excellent — production-ready expert Skill |
| B | 80-89% (96-107) | Good — minor improvements needed |
| C | 70-79% (84-95) | Adequate — clear improvement path |
| D | 60-69% (72-83) | Below Average — significant issues |
| F | <60% (<72) | Poor — needs fundamental redesign |
