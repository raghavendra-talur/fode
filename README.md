# fode

An entity-based code viewer. Instead of navigating files, you navigate **code entities** — functions, types, interfaces — and their relationships.

## Concept

Traditional IDEs organize code by files. fode organizes code by **entities**:

1. **Repo dashboard** — Open a repository and see its metadata: language, module name, package count, key config files
2. **Entity search** — A central search bar queries parsed AST entities (via tree-sitter), not filenames
3. **Focus view** — Select an entity to see it front-and-center, with related entities (callers, callees, type references, package siblings) arranged around it

## Supported Languages

- Go
- Rust
- Python
- JavaScript

## Tech Stack

- **Tauri v2** — native desktop app with a web frontend
- **Rust** backend with **tree-sitter** for language-agnostic AST parsing
- **Vanilla HTML/CSS/JS** frontend

## Development

```
# Install dependencies
cargo install tauri-cli --version "^2"

# Build and run
cargo tauri dev

# Build release
cargo tauri build
```

## License

Apache-2.0
