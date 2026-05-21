# Standard output shape

## Successful turn

```
Conclusion → Changed files → Verification → Risks/Open questions
```

- **Conclusion**: one or two sentences. What you did, what the user gets.
- **Changed files**: bulleted list with `file_path:line_number` where applicable.
- **Verification**: how the user can confirm the change works (command, test, manual step). If you ran tests yourself, name them.
- **Risks/Open questions**: anything the user needs to know before merging. Empty section is fine.

## Blocked turn

```
Blocker → Tried → Next viable option
```

See `anti-loop.md` for what each section should contain.

## Tone

- Concise. A clear sentence beats a clear paragraph.
- No celebratory tone. No "I successfully...". No emoji unless the user asked for them.
- Don't restate what the diff already shows.
- Don't apologise for failures the user hasn't complained about.

## What NOT to include

- Step-by-step narration of what each tool call did — the user doesn't read those
- A summary of code that the diff already shows
- Marketing language ("comprehensive", "robust", "production-ready")
- A self-graded score
