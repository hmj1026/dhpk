# architect — Yii 1.1 layering conventions

| Trigger | Action | Non-apply |
|---|---|---|
| Controller talking past the service / Repository boundary (not `Controller → $this->app()->{service}->fetchXxx() → Repository->forXxx()`) | route through the service; name Repository methods `forXxx` | a thin controller that only calls one service method |
| Inter-module call coupling to a Model directly | go through a Service; never direct Model coupling | — |
| Shared logic duplicated across controllers / modules | extract to a Behavior or Component | — |

Layer detail: `protected/CLAUDE.md`, `domain/CLAUDE.md`, `infrastructure/CLAUDE.md`

PHP 5.6 limits: `modules/php-5.6/references/coding-style.md`

Deeper examples: `skills/dhpk-php-runtime-router/references/agent-extracts/architect-code-examples.md`
