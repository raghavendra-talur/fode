use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tree_sitter::{Language, Parser, Tree};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum EntityKind {
    Function,
    Method,
    Struct,
    Interface,
    TypeAlias,
    Constant,
    Variable,
    Import,
    Package,
    Class,
    Enum,
    Trait,
    Module,
}

impl EntityKind {
    pub fn label(&self) -> &str {
        match self {
            EntityKind::Function => "function",
            EntityKind::Method => "method",
            EntityKind::Struct => "struct",
            EntityKind::Interface => "interface",
            EntityKind::TypeAlias => "type",
            EntityKind::Constant => "const",
            EntityKind::Variable => "var",
            EntityKind::Import => "import",
            EntityKind::Package => "package",
            EntityKind::Class => "class",
            EntityKind::Enum => "enum",
            EntityKind::Trait => "trait",
            EntityKind::Module => "module",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: String,
    pub name: String,
    pub kind: EntityKind,
    pub file: String,
    pub line: usize,
    pub end_line: usize,
    pub source: String,
    pub signature: String,
    pub package: String,
    pub doc_comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum RelationKind {
    Calls,
    CalledBy,
    References,
    ReferencedBy,
    Contains,
    ContainedBy,
    Implements,
    ImplementedBy,
    Returns,
    Accepts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relation {
    pub from_id: String,
    pub to_id: String,
    pub kind: RelationKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub language: String,
    pub total_files: usize,
    pub total_entities: usize,
    pub packages: Vec<String>,
    pub module_name: String,
    pub attributes: Vec<RepoAttribute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoAttribute {
    pub label: String,
    pub value: String,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityGraph {
    pub entities: Vec<Entity>,
    pub relations: Vec<Relation>,
}

#[derive(Debug)]
pub enum DetectedLanguage {
    Go,
    Rust,
    Python,
    JavaScript,
}

impl DetectedLanguage {
    pub fn name(&self) -> &str {
        match self {
            DetectedLanguage::Go => "Go",
            DetectedLanguage::Rust => "Rust",
            DetectedLanguage::Python => "Python",
            DetectedLanguage::JavaScript => "JavaScript",
        }
    }

    pub fn extensions(&self) -> &[&str] {
        match self {
            DetectedLanguage::Go => &["go"],
            DetectedLanguage::Rust => &["rs"],
            DetectedLanguage::Python => &["py"],
            DetectedLanguage::JavaScript => &["js", "jsx", "ts", "tsx"],
        }
    }

    pub fn tree_sitter_language(&self) -> Language {
        match self {
            DetectedLanguage::Go => tree_sitter_go::LANGUAGE.into(),
            DetectedLanguage::Rust => tree_sitter_rust::LANGUAGE.into(),
            DetectedLanguage::Python => tree_sitter_python::LANGUAGE.into(),
            DetectedLanguage::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
        }
    }
}

pub fn detect_language(repo_path: &Path) -> Option<DetectedLanguage> {
    let mut go_count = 0;
    let mut rs_count = 0;
    let mut py_count = 0;
    let mut js_count = 0;

    for entry in WalkDir::new(repo_path)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
            match ext {
                "go" => go_count += 1,
                "rs" => rs_count += 1,
                "py" => py_count += 1,
                "js" | "jsx" | "ts" | "tsx" => js_count += 1,
                _ => {}
            }
        }
    }

    let max = go_count.max(rs_count).max(py_count).max(js_count);
    if max == 0 {
        return None;
    }

    if go_count == max {
        Some(DetectedLanguage::Go)
    } else if rs_count == max {
        Some(DetectedLanguage::Rust)
    } else if py_count == max {
        Some(DetectedLanguage::Python)
    } else {
        Some(DetectedLanguage::JavaScript)
    }
}

pub fn collect_source_files(repo_path: &Path, lang: &DetectedLanguage) -> Vec<PathBuf> {
    let extensions = lang.extensions();
    WalkDir::new(repo_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            // Skip hidden dirs, vendor, node_modules, target
            let path = e.path();
            !path.components().any(|c| {
                let s = c.as_os_str().to_str().unwrap_or("");
                s.starts_with('.')
                    || s == "vendor"
                    || s == "node_modules"
                    || s == "target"
                    || s == "testdata"
            })
        })
        .filter(|e| {
            if let Some(ext) = e.path().extension().and_then(|x| x.to_str()) {
                extensions.contains(&ext)
            } else {
                false
            }
        })
        .map(|e| e.into_path())
        .collect()
}

pub fn parse_file(source: &str, language: Language) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(&language).ok()?;
    parser.parse(source, None)
}

fn make_entity_id(file: &str, name: &str, kind: &EntityKind) -> String {
    format!("{}::{}::{}", file, kind.label(), name)
}

fn get_doc_comment(source: &[u8], node: &tree_sitter::Node) -> String {
    // Look for comment nodes immediately preceding the entity
    let mut comments = Vec::new();
    let mut sibling = node.prev_sibling();
    while let Some(s) = sibling {
        if s.kind() == "comment" {
            let text = std::str::from_utf8(&source[s.byte_range()]).unwrap_or("").to_string();
            comments.push(text);
            sibling = s.prev_sibling();
        } else {
            break;
        }
    }
    comments.reverse();
    comments.join("\n")
}

pub fn extract_entities_go(
    source: &str,
    tree: &Tree,
    file_path: &str,
    package: &str,
) -> Vec<Entity> {
    let mut entities = Vec::new();
    let root = tree.root_node();
    let bytes = source.as_bytes();

    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match child.kind() {
            "function_declaration" => {
                if let Some(name_node) = child.child_by_field_name("name") {
                    let name = std::str::from_utf8(&bytes[name_node.byte_range()])
                        .unwrap_or("")
                        .to_string();
                    let full_source =
                        std::str::from_utf8(&bytes[child.byte_range()]).unwrap_or("");
                    let signature = full_source.lines().next().unwrap_or("").to_string();
                    let doc = get_doc_comment(bytes, &child);

                    entities.push(Entity {
                        id: make_entity_id(file_path, &name, &EntityKind::Function),
                        name,
                        kind: EntityKind::Function,
                        file: file_path.to_string(),
                        line: child.start_position().row + 1,
                        end_line: child.end_position().row + 1,
                        source: full_source.to_string(),
                        signature,
                        package: package.to_string(),
                        doc_comment: doc,
                    });
                }
            }
            "method_declaration" => {
                if let Some(name_node) = child.child_by_field_name("name") {
                    let name = std::str::from_utf8(&bytes[name_node.byte_range()])
                        .unwrap_or("")
                        .to_string();
                    let full_source =
                        std::str::from_utf8(&bytes[child.byte_range()]).unwrap_or("");
                    let signature = full_source.lines().next().unwrap_or("").to_string();
                    let doc = get_doc_comment(bytes, &child);

                    // Get receiver type
                    let mut receiver = String::new();
                    if let Some(params) = child.child_by_field_name("receiver") {
                        receiver =
                            std::str::from_utf8(&bytes[params.byte_range()]).unwrap_or("").to_string();
                    }

                    let display_name = if receiver.is_empty() {
                        name.clone()
                    } else {
                        format!("{}.{}", receiver, name)
                    };

                    entities.push(Entity {
                        id: make_entity_id(file_path, &display_name, &EntityKind::Method),
                        name: display_name,
                        kind: EntityKind::Method,
                        file: file_path.to_string(),
                        line: child.start_position().row + 1,
                        end_line: child.end_position().row + 1,
                        source: full_source.to_string(),
                        signature,
                        package: package.to_string(),
                        doc_comment: doc,
                    });
                }
            }
            "type_declaration" => {
                // Type declarations can contain type_spec children
                let mut spec_cursor = child.walk();
                for spec in child.children(&mut spec_cursor) {
                    if spec.kind() == "type_spec" {
                        if let Some(name_node) = spec.child_by_field_name("name") {
                            let name = std::str::from_utf8(&bytes[name_node.byte_range()])
                                .unwrap_or("")
                                .to_string();
                            let full_source =
                                std::str::from_utf8(&bytes[child.byte_range()]).unwrap_or("");
                            let doc = get_doc_comment(bytes, &child);

                            // Determine if struct or interface
                            let type_node = spec.child_by_field_name("type");
                            let kind = if let Some(tn) = type_node {
                                match tn.kind() {
                                    "struct_type" => EntityKind::Struct,
                                    "interface_type" => EntityKind::Interface,
                                    _ => EntityKind::TypeAlias,
                                }
                            } else {
                                EntityKind::TypeAlias
                            };

                            let signature = format!("type {} ...", name);

                            entities.push(Entity {
                                id: make_entity_id(file_path, &name, &kind),
                                name,
                                kind,
                                file: file_path.to_string(),
                                line: child.start_position().row + 1,
                                end_line: child.end_position().row + 1,
                                source: full_source.to_string(),
                                signature,
                                package: package.to_string(),
                                doc_comment: doc,
                            });
                        }
                    }
                }
            }
            "const_declaration" | "var_declaration" => {
                let is_const = child.kind() == "const_declaration";
                let kind = if is_const {
                    EntityKind::Constant
                } else {
                    EntityKind::Variable
                };

                let mut spec_cursor = child.walk();
                for spec in child.children(&mut spec_cursor) {
                    if spec.kind() == "const_spec" || spec.kind() == "var_spec" {
                        if let Some(name_node) = spec.child_by_field_name("name") {
                            let name = std::str::from_utf8(&bytes[name_node.byte_range()])
                                .unwrap_or("")
                                .to_string();
                            let full_source =
                                std::str::from_utf8(&bytes[spec.byte_range()]).unwrap_or("");
                            let doc = get_doc_comment(bytes, &child);

                            entities.push(Entity {
                                id: make_entity_id(file_path, &name, &kind),
                                name,
                                kind: kind.clone(),
                                file: file_path.to_string(),
                                line: spec.start_position().row + 1,
                                end_line: spec.end_position().row + 1,
                                source: full_source.to_string(),
                                signature: full_source.lines().next().unwrap_or("").to_string(),
                                package: package.to_string(),
                                doc_comment: doc,
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    entities
}

pub fn extract_entities_generic(
    source: &str,
    tree: &Tree,
    file_path: &str,
    lang: &DetectedLanguage,
) -> Vec<Entity> {
    let mut entities = Vec::new();
    let root = tree.root_node();
    let bytes = source.as_bytes();

    // Walk all top-level and nested definitions
    fn walk_node(
        node: tree_sitter::Node,
        bytes: &[u8],
        file_path: &str,
        package: &str,
        entities: &mut Vec<Entity>,
        lang: &DetectedLanguage,
    ) {
        let kind_opt = match (lang, node.kind()) {
            // Rust
            (DetectedLanguage::Rust, "function_item") => Some(EntityKind::Function),
            (DetectedLanguage::Rust, "struct_item") => Some(EntityKind::Struct),
            (DetectedLanguage::Rust, "enum_item") => Some(EntityKind::Enum),
            (DetectedLanguage::Rust, "trait_item") => Some(EntityKind::Trait),
            (DetectedLanguage::Rust, "impl_item") => None, // We descend into impl blocks
            (DetectedLanguage::Rust, "type_item") => Some(EntityKind::TypeAlias),
            (DetectedLanguage::Rust, "const_item") => Some(EntityKind::Constant),
            (DetectedLanguage::Rust, "static_item") => Some(EntityKind::Variable),
            (DetectedLanguage::Rust, "mod_item") => Some(EntityKind::Module),
            // Python
            (DetectedLanguage::Python, "function_definition") => Some(EntityKind::Function),
            (DetectedLanguage::Python, "class_definition") => Some(EntityKind::Class),
            // JavaScript/TypeScript
            (DetectedLanguage::JavaScript, "function_declaration") => Some(EntityKind::Function),
            (DetectedLanguage::JavaScript, "class_declaration") => Some(EntityKind::Class),
            (DetectedLanguage::JavaScript, "lexical_declaration") => Some(EntityKind::Variable),
            (DetectedLanguage::JavaScript, "variable_declaration") => Some(EntityKind::Variable),
            _ => None,
        };

        if let Some(kind) = kind_opt {
            let name = node
                .child_by_field_name("name")
                .map(|n| std::str::from_utf8(&bytes[n.byte_range()]).unwrap_or("").to_string())
                .unwrap_or_else(|| "<anonymous>".to_string());

            if name != "<anonymous>" {
                let full_source = std::str::from_utf8(&bytes[node.byte_range()]).unwrap_or("");
                let signature = full_source.lines().next().unwrap_or("").to_string();
                let doc = get_doc_comment(bytes, &node);

                entities.push(Entity {
                    id: make_entity_id(file_path, &name, &kind),
                    name,
                    kind,
                    file: file_path.to_string(),
                    line: node.start_position().row + 1,
                    end_line: node.end_position().row + 1,
                    source: full_source.to_string(),
                    signature,
                    package: package.to_string(),
                    doc_comment: doc,
                });
            }
        }

        // Recurse into children
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            walk_node(child, bytes, file_path, package, entities, lang);
        }
    }

    let package = Path::new(file_path)
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    walk_node(root, bytes, file_path, &package, &mut entities, lang);
    entities
}

/// Metadata about an entity used during reference resolution.
pub(crate) struct EntityMeta {
    /// Repo-relative directory path (unique package identifier).
    /// e.g. "internal/controller", "cmd/hub", "."
    pkg_dir: String,
}

/// Map of import qualifier (local name) -> repo-relative directory path.
/// Built per source file from its import declarations + go.mod module path.
type ImportMap = HashMap<String, String>;

/// Parse Go import declarations from a source file.
/// Returns a map of local_name -> full_import_path.
fn parse_go_imports(source: &str, tree: &Tree) -> HashMap<String, String> {
    let mut imports = HashMap::new();
    let root = tree.root_node();
    let bytes = source.as_bytes();

    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() != "import_declaration" {
            continue;
        }
        let mut inner = child.walk();
        for spec in child.children(&mut inner) {
            if spec.kind() == "import_spec" {
                // import_spec can have: name? path
                let path_node = spec.child_by_field_name("path");
                let name_node = spec.child_by_field_name("name");

                if let Some(path_n) = path_node {
                    let import_path = std::str::from_utf8(&bytes[path_n.byte_range()])
                        .unwrap_or("")
                        .trim_matches('"')
                        .to_string();

                    let local_name = if let Some(name_n) = name_node {
                        let n = std::str::from_utf8(&bytes[name_n.byte_range()])
                            .unwrap_or("")
                            .to_string();
                        if n == "." || n == "_" {
                            continue; // dot imports and blank imports — skip for now
                        }
                        n
                    } else {
                        // Default: last segment of import path
                        import_path.rsplit('/').next().unwrap_or(&import_path).to_string()
                    };

                    imports.insert(local_name, import_path);
                }
            } else if spec.kind() == "import_spec_list" {
                // Parenthesized import block
                let mut list_cursor = spec.walk();
                for item in spec.children(&mut list_cursor) {
                    if item.kind() == "import_spec" {
                        let path_node = item.child_by_field_name("path");
                        let name_node = item.child_by_field_name("name");

                        if let Some(path_n) = path_node {
                            let import_path = std::str::from_utf8(&bytes[path_n.byte_range()])
                                .unwrap_or("")
                                .trim_matches('"')
                                .to_string();

                            let local_name = if let Some(name_n) = name_node {
                                let n = std::str::from_utf8(&bytes[name_n.byte_range()])
                                    .unwrap_or("")
                                    .to_string();
                                if n == "." || n == "_" {
                                    continue;
                                }
                                n
                            } else {
                                import_path.rsplit('/').next().unwrap_or(&import_path).to_string()
                            };

                            imports.insert(local_name, import_path);
                        }
                    }
                }
            }
        }
    }
    imports
}

/// Resolve a Go import qualifier to a repo-relative directory path.
/// Strips the module prefix from the full import path.
fn resolve_import_to_dir(
    qualifier: &str,
    file_imports: &ImportMap,
    module_path: &str,
) -> Option<String> {
    let full_path = file_imports.get(qualifier)?;
    if let Some(rel) = full_path.strip_prefix(module_path) {
        let rel = rel.trim_start_matches('/');
        if rel.is_empty() {
            Some(".".to_string())
        } else {
            Some(rel.to_string())
        }
    } else {
        // External dependency — not in this repo
        None
    }
}

/// Get the repo-relative directory for a file path.
fn file_dir(file_path: &str) -> String {
    Path::new(file_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or(".")
        .to_string()
}

/// Extract references from entities in a single file.
///
/// Resolution strategy (Go-specific, with fallback for other languages):
/// - Qualified refs (pkg.Name): resolve qualifier through file imports + module
///   path to get a repo-relative dir, then match entities in that dir.
/// - Bare identifiers: match entities in the same directory (same package).
pub fn extract_references(
    source: &str,
    tree: &Tree,
    file_entities: &[Entity],
    all_entity_names: &HashMap<String, Vec<String>>,
    entity_meta: &HashMap<String, EntityMeta>,
    file_import_dirs: &ImportMap,
    caller_pkg_dir: &str,
) -> Vec<Relation> {
    let mut relations = Vec::new();
    let root = tree.root_node();
    let bytes = source.as_bytes();
    let mut seen: HashSet<(String, String)> = HashSet::new();

    fn try_add(
        from_id: &str,
        to_id: &str,
        kind: RelationKind,
        seen: &mut HashSet<(String, String)>,
        relations: &mut Vec<Relation>,
    ) -> bool {
        if from_id == to_id {
            return false;
        }
        let key = (from_id.to_string(), to_id.to_string());
        if seen.insert(key) {
            relations.push(Relation {
                from_id: from_id.to_string(),
                to_id: to_id.to_string(),
                kind,
            });
            true
        } else {
            false
        }
    }

    /// Match a name against entities, filtering by expected pkg_dir.
    fn match_targets(
        name: &str,
        expected_dir: &str,
        from_id: &str,
        kind: &RelationKind,
        name_to_ids: &HashMap<String, Vec<String>>,
        entity_meta: &HashMap<String, EntityMeta>,
        seen: &mut HashSet<(String, String)>,
        relations: &mut Vec<Relation>,
    ) {
        if let Some(target_ids) = name_to_ids.get(name) {
            for target_id in target_ids {
                if let Some(meta) = entity_meta.get(target_id.as_str()) {
                    if meta.pkg_dir == expected_dir {
                        try_add(from_id, target_id, kind.clone(), seen, relations);
                    }
                }
            }
        }
    }

    fn find_references(
        node: tree_sitter::Node,
        bytes: &[u8],
        from_id: &str,
        caller_pkg_dir: &str,
        file_import_dirs: &ImportMap,
        name_to_ids: &HashMap<String, Vec<String>>,
        entity_meta: &HashMap<String, EntityMeta>,
        relations: &mut Vec<Relation>,
        seen: &mut HashSet<(String, String)>,
    ) {
        // Handle call expressions: pkg.Func() or Func()
        if node.kind() == "call_expression" || node.kind() == "call" {
            if let Some(func_node) = node.child_by_field_name("function") {
                let func_text = std::str::from_utf8(&bytes[func_node.byte_range()])
                    .unwrap_or("");

                if func_text.contains('.') {
                    // Qualified call: qualifier.Name()
                    let simple_name = func_text.rsplit('.').next().unwrap_or(func_text);
                    if let Some(qualifier) = func_text.rsplitn(2, '.').nth(1) {
                        // Resolve qualifier via imports to a dir path
                        if let Some(target_dir) = file_import_dirs.get(qualifier) {
                            match_targets(
                                simple_name, target_dir, from_id, &RelationKind::Calls,
                                name_to_ids, entity_meta, seen, relations,
                            );
                        }
                        // Also try matching methods: qualifier might be a variable,
                        // not a package. In that case the method receiver type is
                        // in the same package.
                        if !file_import_dirs.contains_key(qualifier) {
                            match_targets(
                                simple_name, caller_pkg_dir, from_id, &RelationKind::Calls,
                                name_to_ids, entity_meta, seen, relations,
                            );
                        }
                    }
                } else {
                    // Bare call: same package only
                    match_targets(
                        func_text, caller_pkg_dir, from_id, &RelationKind::Calls,
                        name_to_ids, entity_meta, seen, relations,
                    );
                }
            }
            // Recurse into arguments but skip the function child
            let func_id = node.child_by_field_name("function").map(|n| n.id());
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if Some(child.id()) != func_id && child.kind() != "selector_expression" {
                    find_references(child, bytes, from_id, caller_pkg_dir, file_import_dirs, name_to_ids, entity_meta, relations, seen);
                }
            }
            return;
        }

        // Handle selector expressions: pkg.Type (non-call context)
        if node.kind() == "selector_expression" || node.kind() == "qualified_type" {
            let qualifier_text = node.child(0)
                .and_then(|n| std::str::from_utf8(&bytes[n.byte_range()]).ok());
            let field_text = node.child_by_field_name("field")
                .and_then(|n| std::str::from_utf8(&bytes[n.byte_range()]).ok());

            if let (Some(qual), Some(field)) = (qualifier_text, field_text) {
                if let Some(target_dir) = file_import_dirs.get(qual) {
                    match_targets(
                        field, target_dir, from_id, &RelationKind::References,
                        name_to_ids, entity_meta, seen, relations,
                    );
                }
                // Method/field on local variable — same package
                if !file_import_dirs.contains_key(qual) {
                    match_targets(
                        field, caller_pkg_dir, from_id, &RelationKind::References,
                        name_to_ids, entity_meta, seen, relations,
                    );
                }
            }
            return;
        }

        // Bare identifiers: same directory only
        if node.kind() == "type_identifier" || node.kind() == "identifier" {
            let name = std::str::from_utf8(&bytes[node.byte_range()]).unwrap_or("");
            match_targets(
                name, caller_pkg_dir, from_id, &RelationKind::References,
                name_to_ids, entity_meta, seen, relations,
            );
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            find_references(child, bytes, from_id, caller_pkg_dir, file_import_dirs, name_to_ids, entity_meta, relations, seen);
        }
    }

    for entity in file_entities {
        fn find_node_at(
            node: tree_sitter::Node,
            start_line: usize,
            end_line: usize,
        ) -> Option<tree_sitter::Node> {
            if node.start_position().row + 1 == start_line
                && node.end_position().row + 1 == end_line
            {
                return Some(node);
            }
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if let Some(found) = find_node_at(child, start_line, end_line) {
                    return Some(found);
                }
            }
            None
        }

        if let Some(entity_node) = find_node_at(root, entity.line, entity.end_line) {
            find_references(
                entity_node,
                bytes,
                &entity.id,
                caller_pkg_dir,
                file_import_dirs,
                all_entity_names,
                entity_meta,
                &mut relations,
                &mut seen,
            );
        }
    }

    relations
}

pub fn get_go_package(source: &str, tree: &Tree) -> String {
    let root = tree.root_node();
    let bytes = source.as_bytes();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() == "package_clause" {
            // The package name is in a child node
            let mut inner = child.walk();
            for c in child.children(&mut inner) {
                if c.kind() == "package_identifier" {
                    return std::str::from_utf8(&bytes[c.byte_range()])
                        .unwrap_or("main")
                        .to_string();
                }
            }
        }
    }
    "main".to_string()
}

pub fn get_go_module_name(repo_path: &Path) -> String {
    let go_mod = repo_path.join("go.mod");
    if let Ok(content) = std::fs::read_to_string(&go_mod) {
        for line in content.lines() {
            if line.starts_with("module ") {
                return line.trim_start_matches("module ").trim().to_string();
            }
        }
    }
    repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

pub fn build_repo_info(repo_path: &Path, lang: &DetectedLanguage, graph: &EntityGraph) -> RepoInfo {
    let name = repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let files = collect_source_files(repo_path, lang);
    let mut packages: Vec<String> = graph
        .entities
        .iter()
        .map(|e| e.package.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    packages.sort();

    let mut attributes = Vec::new();

    match lang {
        DetectedLanguage::Go => {
            let module_name = get_go_module_name(repo_path);
            attributes.push(RepoAttribute {
                label: "Module".to_string(),
                value: module_name.clone(),
                link: None,
            });
            attributes.push(RepoAttribute {
                label: "Packages".to_string(),
                value: packages.len().to_string(),
                link: None,
            });
            let go_mod = repo_path.join("go.mod");
            if go_mod.exists() {
                attributes.push(RepoAttribute {
                    label: "go.mod".to_string(),
                    value: "go.mod".to_string(),
                    link: Some(go_mod.to_string_lossy().to_string()),
                });
            }

            RepoInfo {
                path: repo_path.to_string_lossy().to_string(),
                name,
                language: lang.name().to_string(),
                total_files: files.len(),
                total_entities: graph.entities.len(),
                packages,
                module_name,
                attributes,
            }
        }
        _ => {
            attributes.push(RepoAttribute {
                label: "Language".to_string(),
                value: lang.name().to_string(),
                link: None,
            });
            attributes.push(RepoAttribute {
                label: "Files".to_string(),
                value: files.len().to_string(),
                link: None,
            });
            attributes.push(RepoAttribute {
                label: "Packages".to_string(),
                value: packages.len().to_string(),
                link: None,
            });

            let module_name = name.clone();
            RepoInfo {
                path: repo_path.to_string_lossy().to_string(),
                name,
                language: lang.name().to_string(),
                total_files: files.len(),
                total_entities: graph.entities.len(),
                packages,
                module_name,
                attributes,
            }
        }
    }
}

pub fn parse_repo(repo_path: &Path) -> Option<(RepoInfo, EntityGraph)> {
    eprintln!("[fode] parse_repo: {:?}", repo_path);

    let lang = detect_language(repo_path)?;
    eprintln!("[fode] detected language: {}", lang.name());

    let ts_lang = lang.tree_sitter_language();
    let files = collect_source_files(repo_path, &lang);
    eprintln!("[fode] found {} source files", files.len());

    // Track which entities belong to which file (by index in files vec)
    let mut all_entities = Vec::new();
    let mut file_entity_ranges: Vec<(usize, usize)> = Vec::new(); // (start, end) into all_entities

    for (i, file_path) in files.iter().enumerate() {
        let source = match std::fs::read_to_string(file_path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[fode] skip file (read error): {:?}: {}", file_path, e);
                file_entity_ranges.push((all_entities.len(), all_entities.len()));
                continue;
            }
        };
        let tree = match parse_file(&source, ts_lang.clone()) {
            Some(t) => t,
            None => {
                eprintln!("[fode] skip file (parse error): {:?}", file_path);
                file_entity_ranges.push((all_entities.len(), all_entities.len()));
                continue;
            }
        };

        let rel_path = file_path
            .strip_prefix(repo_path)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        let start = all_entities.len();
        let entities = match lang {
            DetectedLanguage::Go => {
                let pkg = get_go_package(&source, &tree);
                extract_entities_go(&source, &tree, &rel_path, &pkg)
            }
            _ => extract_entities_generic(&source, &tree, &rel_path, &lang),
        };
        all_entities.extend(entities);
        file_entity_ranges.push((start, all_entities.len()));

        if (i + 1) % 100 == 0 {
            eprintln!("[fode] parsed {}/{} files, {} entities so far", i + 1, files.len(), all_entities.len());
        }
    }

    eprintln!("[fode] extracted {} entities total, building references...", all_entities.len());

    // For Go, read the module path for import resolution
    let module_path = if matches!(lang, DetectedLanguage::Go) {
        get_go_module_name(repo_path)
    } else {
        String::new()
    };

    // Build global name lookup once
    let name_to_ids: HashMap<String, Vec<String>> = {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for e in &all_entities {
            map.entry(e.name.clone()).or_default().push(e.id.clone());
        }
        map
    };

    // Build entity metadata: id -> pkg_dir (repo-relative directory path)
    let entity_meta: HashMap<String, EntityMeta> = all_entities
        .iter()
        .map(|e| (e.id.clone(), EntityMeta { pkg_dir: file_dir(&e.file) }))
        .collect();

    // Extract cross-references, scoped per file
    let mut all_relations = Vec::new();
    for (i, file_path) in files.iter().enumerate() {
        let (start, end) = file_entity_ranges[i];
        if start == end {
            continue; // no entities in this file
        }

        let source = match std::fs::read_to_string(file_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let tree = match parse_file(&source, ts_lang.clone()) {
            Some(t) => t,
            None => continue,
        };

        // Build per-file import map: qualifier -> repo-relative dir
        let file_import_dirs: ImportMap = if matches!(lang, DetectedLanguage::Go) {
            let raw_imports = parse_go_imports(&source, &tree);
            raw_imports
                .into_iter()
                .filter_map(|(local_name, full_path)| {
                    resolve_import_to_dir(&local_name, &{
                        let mut m = HashMap::new();
                        m.insert(local_name.clone(), full_path);
                        m
                    }, &module_path)
                    .map(|dir| (local_name, dir))
                })
                .collect()
        } else {
            HashMap::new()
        };

        let rel_path = file_path
            .strip_prefix(repo_path)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();
        let caller_pkg_dir = file_dir(&rel_path);

        let file_entities = &all_entities[start..end];
        let relations = extract_references(
            &source, &tree, file_entities, &name_to_ids, &entity_meta,
            &file_import_dirs, &caller_pkg_dir,
        );
        all_relations.extend(relations);
    }

    eprintln!("[fode] found {} relations", all_relations.len());

    let graph = EntityGraph {
        entities: all_entities,
        relations: all_relations,
    };

    let info = build_repo_info(repo_path, &lang, &graph);
    eprintln!("[fode] done: {} entities, {} relations", info.total_entities, graph.relations.len());
    Some((info, graph))
}
