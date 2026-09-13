# General Techniques

All-models best-practices toolbox. Apply these first, before layering the
model-specific deltas from `model-guides.md`. Pick what's relevant to the task — this is a
toolbox, not a checklist to apply in full every time.

## Clarity and structure

- **Be clear and direct.** State the desired output, format, and constraints explicitly.
  Golden rule: if a colleague with no context on the task would be confused reading the
  prompt, so will Claude.
- **Give the reason, not just the request.** A one-line "why" lets the model generalize
  correctly instead of guessing intent: `"I'm working on [X] for [who]. They need [outcome].
  With that in mind: [request]."`
- **Use XML tags for distinct content types** (`<instructions>`, `<context>`, `<input>`,
  `<example>`) when the prompt mixes several kinds of content — reduces misinterpretation.
  Use consistent tag names; nest tags when content has a natural hierarchy.
- **Give Claude a role** in the system prompt when tone/domain framing matters — even one
  sentence measurably focuses behavior.
- **Use 3-5 relevant, diverse examples** wrapped in `<example>`/`<examples>` tags when output
  format or style needs to be pinned down precisely (few-shot steering).

## Long-context documents (20k+ tokens of reference material)

- Put long documents near the **top** of the prompt; put the actual query/instructions at
  the **end** — this ordering alone can improve response quality substantially on
  multi-document inputs.
- Wrap each document: `<document><source>...</source><document_content>...</document_content></document>`.
- For long-document tasks, ask the model to quote relevant excerpts into `<quotes>` tags
  before answering — cuts through noise in the rest of the document.

## Output-format control

- **Say what TO do, not just what to avoid.** `"Write in flowing prose paragraphs"` beats
  `"Don't use markdown."`
- Match the prompt's own formatting style to the desired output style — heavy markdown in
  the prompt nudges toward heavy markdown in the response.
- Use an explicit `<avoid_excessive_markdown>` block if a prose-heavy, non-bulleted register
  is required.

## Tool-use and agentic steering

- **Imperative beats suggestive when action is wanted**: `"Change this function to improve
  its performance"` gets a direct edit; `"Can you suggest some changes?"` gets a suggestion
  instead of a fix. Match phrasing to the act-vs-suggest answer from
  `completeness-checklist.md`.
- Normal phrasing is enough to trigger a tool on current models — avoid over-aggressive
  language like `"CRITICAL: you MUST use this tool"`, which causes over-triggering. Plain
  `"Use this tool when..."` is sufficient.
- **Parallel tool calls** are default-on; steer further only if needed: `"If you intend to
  call multiple independent tools, make all the calls in parallel rather than sequentially.
  Never call dependent tools in parallel."` To force sequential execution instead: `"Execute
  operations sequentially with brief pauses between steps."`
- **Adaptive-thinking steering**: `"Thinking adds latency — only use it when it will
  meaningfully improve answer quality."` to reduce over-thinking, or `"After tool results,
  reflect carefully before the next action."` to encourage more deliberation.

## Anti-overengineering (reuse, don't reinvent)

When the task is a scoped fix or one-shot operation, reuse this exact family of phrasing
(it already matches the user's own global `~/.claude/rules/common/principles.md`):
`"Don't add features, refactor, or introduce abstractions beyond what the task requires.
Don't add error handling or validation for scenarios that can't happen — trust internal
guarantees, validate only at system boundaries."`

## Long-horizon / multi-session state tracking

For work spanning multiple turns or context windows: recommend a structured state file
(e.g. `tests.json` with pass/fail status) plus freeform progress notes, and use git commits
as checkpoints. Add `"Don't stop early on account of context limits — save progress to
[state file] before continuing"` when the harness compacts or resets context.

## Reusable prompt templates (apply only if the prompt will be reused with variable inputs)

If the raw prompt is clearly meant to be called repeatedly with different inputs (explicit
`{{...}}` placeholders already present, or language like "build a feature that prompts
Claude with X each time"), convert the variable parts to `{{double_brace}}` placeholders
wrapped in XML tags, e.g. `<sentence_to_classify>{{sentence}}</sentence_to_classify>`. For
high-accuracy, complex classification/extraction templates, layer in the prompt-improver
pattern: identify the fixed vs variable parts, produce a structured XML-tagged draft, add
explicit step-by-step reasoning instructions, then reformat any examples to demonstrate that
same reasoning. Skip this section entirely for one-off, single-use task prompts.
