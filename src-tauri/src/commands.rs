use crate::parser::{self, Entity, EntityGraph, RelationKind, RepoInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub repo_info: Mutex<Option<RepoInfo>>,
    pub entity_graph: Mutex<Option<EntityGraph>>,
    pub repo_path: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub entity: Entity,
    pub score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FocusView {
    pub center: Entity,
    /// Entities that call/reference this entity (incoming edges)
    pub incoming: Vec<IncomingRef>,
    /// Same-package entities (compact: just signature)
    pub same_pkg: Vec<SamePkgEntry>,
    /// Same-module, different-package references (grouped summaries)
    pub same_module: Vec<ModulePkgGroup>,
    /// External module/package dependencies
    pub external_deps: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IncomingRef {
    pub entity: Entity,
    pub relation: String,
}

/// Compact same-package reference — just the signature and kind, clickable.
#[derive(Debug, Serialize, Deserialize)]
pub struct SamePkgEntry {
    pub id: String,
    pub kind: String,
    pub signature: String,
}

/// Summary for a cross-package reference within the same module.
#[derive(Debug, Serialize, Deserialize)]
pub struct ModulePkgGroup {
    /// Display name for the package (last segment of dir path)
    pub pkg_name: String,
    /// Repo-relative dir path
    pub pkg_dir: String,
    /// How many functions/methods referenced
    pub fn_count: usize,
    /// How many types referenced
    pub type_count: usize,
}

#[tauri::command]
pub async fn open_repo(path: String, state: State<'_, AppState>) -> Result<RepoInfo, String> {
    let repo_path = PathBuf::from(&path);
    if !repo_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    eprintln!("[fode] open_repo command called with: {}", path);

    // Run parsing on a blocking thread so we don't freeze the UI
    let (info, graph) = tokio::task::spawn_blocking(move || {
        parser::parse_repo(&repo_path)
    })
    .await
    .map_err(|e| format!("Parse task failed: {}", e))?
    .ok_or_else(|| "Failed to parse repository. No supported language files found.".to_string())?;

    *state.repo_info.lock().unwrap() = Some(info.clone());
    *state.entity_graph.lock().unwrap() = Some(graph);
    *state.repo_path.lock().unwrap() = Some(PathBuf::from(&path));

    eprintln!("[fode] open_repo complete: {} entities", info.total_entities);
    Ok(info)
}

#[tauri::command]
pub fn get_repo_info(state: State<AppState>) -> Result<RepoInfo, String> {
    state
        .repo_info
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No repo loaded".to_string())
}

#[tauri::command]
pub fn search_entities(query: String, state: State<AppState>) -> Result<Vec<SearchResult>, String> {
    let graph = state.entity_graph.lock().unwrap();
    let graph = graph.as_ref().ok_or("No repo loaded")?;

    let query_lower = query.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();

    for entity in &graph.entities {
        let name_lower = entity.name.to_lowercase();
        let kind_label = entity.kind.label().to_lowercase();

        // Score based on match quality
        let score = if name_lower == query_lower {
            1.0 // Exact match
        } else if name_lower.starts_with(&query_lower) {
            0.9 // Prefix match
        } else if name_lower.contains(&query_lower) {
            0.7 // Substring match
        } else if kind_label.contains(&query_lower) {
            0.3 // Kind match
        } else if entity.package.to_lowercase().contains(&query_lower) {
            0.4 // Package match
        } else if entity.signature.to_lowercase().contains(&query_lower) {
            0.2 // Signature match
        } else {
            continue;
        };

        results.push(SearchResult {
            entity: entity.clone(),
            score,
        });
    }

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    results.truncate(50);
    Ok(results)
}

#[tauri::command]
pub fn get_entity_focus(entity_id: String, state: State<AppState>) -> Result<FocusView, String> {
    let graph = state.entity_graph.lock().unwrap();
    let graph = graph.as_ref().ok_or("No repo loaded")?;

    let center = graph
        .entities
        .iter()
        .find(|e| e.id == entity_id)
        .ok_or_else(|| format!("Entity not found: {}", entity_id))?
        .clone();

    let center_dir = std::path::Path::new(&center.file)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or(".");

    let mut incoming = Vec::new();
    let mut outgoing_ids = Vec::new();

    // Collect incoming (who references this entity) and outgoing targets
    for relation in &graph.relations {
        if relation.from_id == entity_id {
            outgoing_ids.push(relation.to_id.clone());
        }
        if relation.to_id == entity_id {
            if let Some(source) = graph.entities.iter().find(|e| e.id == relation.from_id) {
                let relation_label = match &relation.kind {
                    RelationKind::Calls => "called by",
                    RelationKind::References => "referenced by",
                    RelationKind::Contains => "contained in",
                    RelationKind::Implements => "implemented by",
                    RelationKind::Returns => "returned by",
                    RelationKind::Accepts => "accepted by",
                    _ => "related to",
                };
                incoming.push(IncomingRef {
                    entity: source.clone(),
                    relation: relation_label.to_string(),
                });
            }
        }
    }

    // --- Partition outgoing references by directory ---
    // Tier 1: same package (same dir), Tier 2: different dir (same module)
    let mut same_pkg = Vec::new();
    let mut cross_pkg_counts: HashMap<String, (usize, usize)> = HashMap::new();

    for target_id in &outgoing_ids {
        if let Some(target) = graph.entities.iter().find(|e| e.id == *target_id) {
            let target_dir = std::path::Path::new(&target.file)
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or(".");
            if target_dir == center_dir {
                // Tier 1: same package — compact signature
                same_pkg.push(SamePkgEntry {
                    id: target.id.clone(),
                    kind: target.kind.label().to_string(),
                    signature: target.signature.clone(),
                });
            } else {
                // Tier 2: different package in same module — count by kind
                let entry = cross_pkg_counts.entry(target_dir.to_string()).or_insert((0, 0));
                match target.kind {
                    parser::EntityKind::Function | parser::EntityKind::Method => entry.0 += 1,
                    _ => entry.1 += 1,
                }
            }
        }
    }

    let mut same_module: Vec<ModulePkgGroup> = cross_pkg_counts
        .into_iter()
        .map(|(dir, (fn_count, type_count))| {
            let pkg_name = dir.rsplit('/').next().unwrap_or(&dir).to_string();
            ModulePkgGroup {
                pkg_name,
                pkg_dir: dir,
                fn_count,
                type_count,
            }
        })
        .collect();
    same_module.sort_by(|a, b| {
        (b.fn_count + b.type_count).cmp(&(a.fn_count + a.type_count))
    });

    // --- Tier 3: External dependencies ---
    let external_deps = graph
        .external_deps
        .get(&entity_id)
        .cloned()
        .unwrap_or_default();

    Ok(FocusView {
        center,
        incoming,
        same_pkg,
        same_module,
        external_deps,
    })
}

#[tauri::command]
pub fn get_all_entities(state: State<AppState>) -> Result<Vec<Entity>, String> {
    let graph = state.entity_graph.lock().unwrap();
    let graph = graph.as_ref().ok_or("No repo loaded")?;
    Ok(graph.entities.clone())
}

#[tauri::command]
pub fn get_entity_source(entity_id: String, state: State<AppState>) -> Result<String, String> {
    let graph = state.entity_graph.lock().unwrap();
    let graph = graph.as_ref().ok_or("No repo loaded")?;
    let entity = graph
        .entities
        .iter()
        .find(|e| e.id == entity_id)
        .ok_or("Entity not found")?;
    Ok(entity.source.clone())
}
