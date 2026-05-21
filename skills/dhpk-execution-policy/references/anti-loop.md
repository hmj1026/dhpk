# Anti-loop guidance

## The 3× rule

When the same approach fails three times in a row, STOP retrying and report.

Loops cost token budget and rarely converge. The third failure is information: the approach is wrong, not the input.

## What counts as "same approach"

- Same command with the same args
- Same edit attempted with slightly different placement
- Same agent invoked with rephrased prompt
- Same test rerun without changing input or environment

What does NOT count:

- A genuinely different command (e.g. trying `cx definition` after `Read` was wrong)
- A test rerun after a code change that should have fixed it
- A different agent type for the same question

## What to report when blocked

```
Blocker → Tried → Next viable option
```

- **Blocker**: the specific symptom (error message, exit code, unexpected output)
- **Tried**: ordered list of approaches that failed AND why each failed
- **Next viable option**: at least two alternatives, with the recommended one first

## Common loop traps

- Running a test in an environment where it cannot pass (missing service, wrong working dir)
- Editing one file to fix a symptom that originates in another
- Trying to make a hook fire by re-editing the same file (hooks fire once per tool call, not per Edit attempt)
- Searching for a function name across the wrong tool (Grep for an AST symbol when `cx definition` is the right tool)
