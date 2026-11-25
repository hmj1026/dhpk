# Rust build-resolver guide

Cargo failures are eligible without a Rust module. A `Cargo.toml` defines the
build unit; preserve the exact package, feature, and target arguments from the
failed command.

## Diagnose

```sh
cargo build --message-format=short 2>&1 | head -60
cargo clippy --all-targets 2>&1 | head -40
cargo test --no-run 2>&1 | head -40
cargo tree -d 2>&1 | head -40
rustc --version; cargo --version
sed -n '1,60p' Cargo.toml
```

| Error | Likely cause | Surgical fix |
|---|---|---|
| `cannot find type/value` | Missing import or typo | Add the path or correct the name |
| `cannot borrow ... as mutable` | Aliasing conflict | Narrow borrows or restructure ownership |
| `does not live long enough` | Owner scope too short | Extend ownership or store an owned value |
| Trait bound not satisfied | Missing impl or bound | Add an honest bound, derive, or impl |
| `Send` / `Sync` or future not `Send` | Non-Send value crosses a task | Scope guards before `.await`, or use correct ownership |
| `mismatched types` | Type mismatch | Fix the value or signature; avoid truncating casts |
| Unresolved import or version conflict | Manifest mismatch | Align the implicated requirement and refresh only its lock entry |

Forbidden shortcuts: new `unsafe`, unjustified `#[allow(...)]`, `.unwrap()` to
dodge a type, or `unsafe impl Send`. `cargo clean` is only for known stale or
corrupt project-local output; it cannot repair a dependency conflict.
