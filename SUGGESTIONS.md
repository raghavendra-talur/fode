# fode — Project Review & Suggestions

## Current State Summary

fode is an entity-based code viewer (~2,250 lines) built with Tauri v2, Rust, and tree-sitter. It parses repositories into an entity graph (functions, types, interfaces, etc.) and presents a search + focus-view UI for navigating code by entities and their relationships rather than by files. Go has the deepest support (import resolution, module-aware references, three-tier outgoing relations). Rust, Python, and JavaScript have basic entity extraction. The project is at v0.1.0 with a solid architectural foundation but significant room to grow.

---

## Directional Changes

These are strategic shifts that would redefine the project's trajectory.

### 1. Integrate with Language Server Protocol (LSP) instead of hand-rolling per-language analysis

**Current state:** Each language has bespoke tree-sitter query logic in `parser.rs`. Go has ~700 lines of specialized parsing (import resolution, qualified calls, module path handling). Other languages get generic extraction with much weaker reference resolution.

**Suggested direction:** Use LSP servers as an optional backend for reference resolution. Tree-sitter is excellent for fast, offline entity extraction (names, signatures, source ranges), but LSP servers already solve the hard problems — cross-file type resolution, go-to-definition, find-all-references — with full semantic accuracy for dozens of languages.

**Concrete approach:**
- Keep tree-sitter for fast entity extraction (it's good at this)
- Spawn language servers (gopls, rust-analyzer, pyright, typescript-language-server) to resolve references
- Use `textDocument/references` and `textDocument/definition` LSP calls to build the relation graph
- Fall back to the current tree-sitter heuristic when no LSP is available

**Why this matters:** The current Go-specific reference resolution in `parser.rs` is ~500 lines and still has edge cases (the git history shows multiple rounds of fixing false cross-references). LSP servers solve this correctly by design. This shift would give every supported language the same quality of reference resolution that Go currently gets, without writing hundreds of lines of per-language logic.

### 2. Shift from flat entity grid to a visual entity graph

**Current state:** The browse view renders all entities in a flat card grid. The focus view shows incoming/outgoing relations as text lists. There is no way to visualize the *shape* of a codebase — which clusters of entities are tightly coupled, which are isolated, where the high-fanout hubs are.

**Suggested direction:** Add a graph visualization mode as the primary way to explore a repository. Entity-based navigation is fundamentally a graph problem; the UI should reflect that.

**Concrete approach:**
- Add a force-directed graph view (d3-force or a WebGL-based renderer for scale) where nodes are entities and edges are relations
- Cluster nodes by package, color by entity kind
- Click a node to open the existing focus view
- Support zoom, pan, and filtering (show only functions, only structs, only a specific package)
- Consider a hierarchical layout (dagre) for call graphs specifically

**Why this matters:** The entity grid works for small repos but becomes overwhelming at scale. A graph visualization would be fode's signature differentiator — no mainstream IDE offers an interactive, navigable dependency graph at the entity level.

### 3. Move from desktop-only to a dual-target architecture (desktop + web)

**Current state:** Tauri bundles the frontend into a native binary. The UI is vanilla HTML/CSS/JS with no build step. There is no way to use fode without installing the desktop app.

**Suggested direction:** Extract the Rust backend into a standalone HTTP server that can serve the same frontend to a browser. Keep Tauri as the desktop packaging layer but make it optional.

**Concrete approach:**
- Add an `axum` or `actix-web` HTTP server mode behind a feature flag
- Expose the same commands (`open_repo`, `search_entities`, `get_entity_focus`, `get_all_entities`) as REST or WebSocket endpoints
- The frontend already uses `invoke()` for all backend calls — swap it for `fetch()` when running in browser mode
- Ship both: `fode` (desktop) and `fode serve` (web server)

**Why this matters:** A web mode enables: (a) using fode on remote servers via SSH port-forwarding, (b) embedding fode views in documentation or code review tools, (c) running fode in CI to generate static entity reports, (d) sharing a live entity graph with teammates via URL.

### 4. Add incremental parsing and file watching

**Current state:** The entire repository is parsed from scratch on every `open_repo` call. There is no caching or incremental update mechanism. For large repositories this will be slow and memory-intensive.

**Suggested direction:** Watch the filesystem for changes and re-parse only modified files.

**Concrete approach:**
- Use `notify` (Rust crate) to watch the repository directory
- Maintain a file→entities index; when a file changes, re-parse only that file and update its entities in the graph
- Invalidate and rebuild relations that touch the changed file's entities
- Persist the parsed entity graph to disk (e.g., SQLite or a binary format) so reopening a repo is instant

**Why this matters:** Without incremental parsing, fode cannot be used as a persistent companion tool during development. Developers need it to stay up-to-date as they edit code, not require a manual re-parse.

---

## New Features

### 5. Syntax highlighting in source display

**Priority: High — Low effort, high impact**

The focus view displays raw source code in a `<pre>` block with no highlighting. Add client-side syntax highlighting using a lightweight library like Prism.js or highlight.js. The language is already known from `RepoInfo`, so the highlighter can be configured automatically.

### 6. Navigation history (back/forward)

**Priority: High — Core UX gap**

There is currently no way to go back after clicking into an entity from the focus view's related-entities panel. Add:
- A navigation stack tracking entity IDs
- Back/forward buttons in the header
- Keyboard shortcuts (Alt+Left/Right or browser-style)
- A breadcrumb trail showing the navigation path

This is essential for the exploratory workflow fode is designed for. Without history, users lose their place after 2-3 clicks.

### 7. Entity filtering in browse view

**Priority: High — Scalability**

The browse view dumps all entities into a grid with no filtering. For a repo with 500+ entities this is unusable. Add:
- Filter chips for entity kinds (functions, types, interfaces, etc.)
- Package/directory filter dropdown
- Sort options (alphabetical, by file, by line count)
- A toggle to collapse/expand packages

### 8. "Open in editor" integration

**Priority: Medium — Bridges fode and the editing workflow**

Add a button on each entity (in both browse and focus views) that opens the source file at the correct line in the user's editor. Tauri's shell plugin is already included. Support:
- `$EDITOR` environment variable
- VS Code (`code --goto file:line`)
- Common editors (vim, neovim, Sublime, IntelliJ)

This turns fode from a standalone viewer into a navigation companion for an existing editor.

### 9. Export entity graph

**Priority: Medium — Enables downstream tooling**

Add export commands:
- **JSON:** Full entity graph with relations (for custom analysis scripts)
- **DOT (Graphviz):** Dependency graph for rendering with `dot` or `fdp`
- **Markdown:** Entity index with signatures and cross-references (for documentation)
- **SVG/PNG:** Screenshot of the graph visualization (once feature #2 is built)

### 10. Git-aware entity diff

**Priority: Medium — Unique differentiator**

Show how entities changed between git commits or branches:
- "What functions were added/modified/deleted in this PR?"
- "When was this function last changed?"
- Parse two commits, diff the entity graphs, and display added/removed/changed entities
- This would be genuinely novel — no existing tool presents diffs at the entity level rather than the line level

### 11. Codebase metrics dashboard

**Priority: Low — Nice to have**

Add a metrics panel to the repo dashboard:
- Entity count by kind (bar chart)
- Largest functions/methods by line count
- Most-referenced entities (highest in-degree in the relation graph)
- Package coupling metrics (cross-package reference density)
- Dead code candidates (entities with zero incoming references)

### 12. Bookmarks and workspaces

**Priority: Low — Power user feature**

Let users pin entities to a persistent sidebar for quick access. Support saving and loading "workspaces" — named sets of bookmarked entities for different investigation contexts (e.g., "auth flow", "database layer", "API handlers").

---

## Architecture & Code Quality

### 13. Add a test suite

The project has zero tests. At minimum:
- **Parser unit tests:** Parse a known Go/Rust/Python file, assert the correct entities and relations are extracted
- **Search tests:** Assert scoring and ranking behavior
- **IPC integration tests:** Use Tauri's test utilities to verify command responses
- Tree-sitter parsing has subtle edge cases (the git history shows multiple false-reference bugs). Tests prevent regressions.

### 14. Split `parser.rs` into per-language modules

`parser.rs` is 1,077 lines and handles all languages plus reference resolution. Split it:
- `parser/mod.rs` — shared types (`Entity`, `Relation`, `EntityGraph`) and the main `parse_repo` orchestrator
- `parser/go.rs` — Go-specific extraction, import resolution, module handling
- `parser/rust.rs` — Rust extraction
- `parser/python.rs` — Python extraction
- `parser/javascript.rs` — JavaScript/TypeScript extraction
- `parser/references.rs` — Cross-language reference resolution logic

This makes each language independently maintainable and testable.

### 15. Replace innerHTML-based rendering with a lightweight framework

The frontend uses raw `innerHTML` string concatenation for all rendering. This is fine at the current scale but:
- Makes XSS bugs easy to introduce (there are `escapeHtml` calls but they must be manually applied everywhere)
- Makes it hard to add interactive state (filters, toggles, selections) without rewriting render functions
- Consider migrating to Preact, Lit, or Solid — small frameworks that add reactivity without a build step or significant bundle size

---

## Prioritized Roadmap

If I were sequencing these, this is the order that maximizes user value at each step:

| Phase | Items | Rationale |
|-------|-------|-----------|
| **1 — Polish** | #5 (syntax highlighting), #6 (navigation history), #7 (entity filtering) | Fix core UX gaps that limit usability today |
| **2 — Foundation** | #13 (tests), #14 (split parser), #4 (incremental parsing) | Build the infrastructure for sustainable growth |
| **3 — Differentiate** | #2 (graph visualization), #10 (git entity diff) | Features that no other tool offers |
| **4 — Expand** | #1 (LSP integration), #3 (web mode), #8 (editor integration) | Broaden reach and language support |
| **5 — Enhance** | #9 (export), #11 (metrics), #12 (bookmarks), #15 (frontend framework) | Power-user features and long-term maintainability |
