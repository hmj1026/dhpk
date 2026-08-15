# architect — Yii 1.1 layering conventions

- Path: `Controller → $this->app()->{service}->fetchXxx() → Repository->forXxx()`
- Repository methods named `forXxx`
- Shared logic via Behavior/Component
- Inter-module via Service, never direct Model coupling
- Layer detail: follow the project's layer-specific guidance for protected, domain, and infrastructure code
- PHP 5.6 limits: the project's PHP coding rules

Deeper examples: consult the installed Codex PHP skill's Yii and legacy-PHP references.
