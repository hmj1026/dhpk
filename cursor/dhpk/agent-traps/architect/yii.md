# architect — Yii 1.1 layering conventions

| Trigger | Action | Non-apply |
|---|---|---|
| Controller talking past the service / Repository boundary (not `Controller → $this->app()->{service}->fetchXxx() → Repository->forXxx()`) | route through the service; name Repository methods `forXxx` | a thin controller that only calls one service method |
| Inter-module call coupling to a Model directly | go through a Service; never direct Model coupling | — |
| Shared logic duplicated across controllers / modules | extract to a Behavior or Component | — |

Layer detail: the project's protected-layer guidance, the project's domain-layer guidance, the project's infrastructure-layer guidance

PHP 5.6 limits: the project's PHP coding rules

Deeper examples: the installed Codex PHP skill's Yii and legacy-PHP references
