Add opt-in project validation failure edit guard. Repeated validation failures
remain advisory by default; `validation_failure_mode:block` preserves
read-only diagnostics while requiring correlated recovery evidence before
Edit, Write, or MultiEdit can continue.
