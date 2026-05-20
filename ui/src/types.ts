export interface Entity {
  id: string
  name: string
  kind: string
  file: string
  line: number
  end_line: number
  byte_start: number
  byte_end: number
  source: string
  signature: string
  package: string
  package_dir: string
  doc_comment: string
}

export interface Repo {
  id: number
  path: string
  name: string
  module_name: string
  language: string
  analyzed_at: number
}

export interface RepoSummary {
  id: number
  path: string
  name: string
  module_name: string
  entity_count: number
  relation_count: number
  analyzed_at: number
}

export interface SearchResult {
  entity: Entity
  score: number
}

export interface Reference {
  entity: Entity
  relation: string
}

export interface SamePkgEntry {
  id: string
  kind: string
  signature: string
}

export interface PkgGroup {
  pkg_name: string
  pkg_dir: string
  fn_count: number
  type_count: number
}

export interface FocusView {
  center: Entity
  callers: Reference[]
  referenced_by: Reference[]
  implementations: Reference[]
  satisfies: Reference[]
  same_pkg: SamePkgEntry[]
  same_module: PkgGroup[]
  external_deps: string[]
}

export interface Ref {
  start: number
  end: number
  to_id: string
}

export interface DeadCodeReport {
  dead: Entity[]
  exported_unused: Entity[]
}

export interface GraphNode {
  id: string
  name: string
  kind: string
  package: string
  package_dir: string
  file: string
  line: number
}

export interface GraphEdge {
  source: string
  target: string
  kind: string
}

export interface PackageInfo {
  name: string
  dir: string
  full_path: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  packages: string[]
  package_info: PackageInfo[]
}

export type ReviewStatus = 'todo' | 'reviewed' | 'flagged'

export interface Review {
  entity_id: string
  status: ReviewStatus
  notes: string
  updated_at: number
}

export interface Comment {
  id: number
  entity_id: string
  line: number | null
  body: string
  created_at: number
}

export interface Edit {
  id: number
  entity_id: string
  base_source: string
  draft_source: string
  status: 'draft' | 'applied'
  created_at: number
  applied_at: number | null
}

export interface ApplyResult {
  applied: boolean
  edit_id: number
  repo_id: number
  entity_id: string
  new_entity_count: number
  new_relation_count: number
}
