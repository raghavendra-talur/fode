use crate::parser::{self, Entity, EntityGraph, RelationKind, RepoInfo};
use serde::{Deserialize, Serialize};
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
    pub related: Vec<RelatedEntity>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RelatedEntity {
    pub entity: Entity,
    pub relation: String,
    pub direction: String, // "incoming" or "outgoing"
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

    let mut related = Vec::new();

    // Find all relations involving this entity
    for relation in &graph.relations {
        if relation.from_id == entity_id {
            if let Some(target) = graph.entities.iter().find(|e| e.id == relation.to_id) {
                let relation_label = match &relation.kind {
                    RelationKind::Calls => "calls",
                    RelationKind::References => "references",
                    RelationKind::Contains => "contains",
                    RelationKind::Implements => "implements",
                    RelationKind::Returns => "returns",
                    RelationKind::Accepts => "accepts",
                    _ => "related to",
                };
                related.push(RelatedEntity {
                    entity: target.clone(),
                    relation: relation_label.to_string(),
                    direction: "outgoing".to_string(),
                });
            }
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
                related.push(RelatedEntity {
                    entity: source.clone(),
                    relation: relation_label.to_string(),
                    direction: "incoming".to_string(),
                });
            }
        }
    }

    // Also find entities in the same directory (same Go package) as "siblings"
    let center_dir = std::path::Path::new(&center.file)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or(".");
    let siblings: Vec<RelatedEntity> = graph
        .entities
        .iter()
        .filter(|e| {
            let e_dir = std::path::Path::new(&e.file)
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or(".");
            e_dir == center_dir && e.id != center.id
        })
        .filter(|e| !related.iter().any(|r| r.entity.id == e.id))
        .take(10)
        .map(|e| RelatedEntity {
            entity: e.clone(),
            relation: "same package".to_string(),
            direction: "sibling".to_string(),
        })
        .collect();

    related.extend(siblings);

    Ok(FocusView { center, related })
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
