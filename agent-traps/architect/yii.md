# architect — Yii 1.1 layering conventions

- Path: `Controller → $this->app()->{service}->fetchXxx() → Repository->forXxx()`
- Repository methods named `forXxx`
- Shared logic via Behavior/Component
- Inter-module via Service, never direct Model coupling
- Layer detail: `protected/CLAUDE.md`, `domain/CLAUDE.md`, `infrastructure/CLAUDE.md`
- PHP 5.6 limits: `.claude/rules/php/coding-style.md`

Deeper examples: `modules/php-5.6/skills/php-pro/references/agent-extracts/architect-code-examples.md`
