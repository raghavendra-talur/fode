// Cell layout. Two-phase positioning:
//
//   Phase 1 — pack the packages. d3-force runs on package centroids only,
//   pulled together by inter-package edge weight and pushed apart by
//   per-package cell radius. Synchronous (300 ticks).
//
//   Phase 2 — lay out entities within each cell, deterministically:
//     • exported entities sit on the membrane (perimeter), grouped by
//       receiver type so a struct + its methods cluster together.
//     • unexported entities fill the cytoplasm via sunflower spiral.
//
// Pure: no React, no DOM. Inputs in, positions out.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { GraphData, GraphNode } from '../../types'

const LAYER_SPACING = 240

export interface CellPos {
  x: number
  y: number
  onMembrane: boolean
}

export interface PackageCell {
  packageDir: string
  packageName: string
  x: number
  y: number
  radius: number
  memberCount: number
  membraneCount: number
  // Ordering captured at layout time so repositionCell can recompute member
  // positions cheaply when the user drags the cell.
  membrane: GraphNode[]
  cytoplasm: GraphNode[]
}

export interface CellLayout {
  packages: Map<string, PackageCell>
  entities: Map<string, CellPos>
}

const TYPE_KINDS = new Set(['struct', 'interface', 'type'])

/** Go visibility: a name is exported iff its first letter is uppercase. */
export function isExported(name: string): boolean {
  const ix = name.lastIndexOf('.')
  const base = ix >= 0 ? name.slice(ix + 1) : name
  if (!base) return false
  const c = base.charCodeAt(0)
  return c >= 65 && c <= 90
}

/** Extract the receiver type from a method entity name like `*Server.Foo` or `Server[T].Foo`. */
export function methodReceiver(name: string): string | null {
  const ix = name.lastIndexOf('.')
  if (ix < 0) return null
  let recv = name.slice(0, ix)
  if (recv.startsWith('*')) recv = recv.slice(1)
  const bracket = recv.indexOf('[')
  if (bracket >= 0) recv = recv.slice(0, bracket)
  return recv
}

function cellRadius(memberCount: number): number {
  if (memberCount === 0) return 40
  return Math.max(55, 35 + Math.sqrt(memberCount) * 14)
}

interface SimPackage extends SimulationNodeDatum {
  id: string
  packageDir: string
  packageName: string
  memberCount: number
  radius: number
  layer: number
}

interface SimPackageLink extends SimulationLinkDatum<SimPackage> {
  weight: number
}

export function layoutCells(graph: GraphData): CellLayout {
  // 1. Group entities by package_dir.
  const membersByDir = new Map<string, GraphNode[]>()
  for (const n of graph.nodes) {
    if (n.kind === 'package') continue
    const list = membersByDir.get(n.package_dir) ?? []
    list.push(n)
    membersByDir.set(n.package_dir, list)
  }

  // 2. Build directed inter-package edges (source-pkg → target-pkg) and
  // accumulate weights for the force layout. Direction matters for layering.
  const entityToDir = new Map<string, string>()
  for (const n of graph.nodes) {
    if (n.kind !== 'package') entityToDir.set(n.id, n.package_dir)
  }
  const depsOf = new Map<string, Set<string>>() // src pkgDir → deps (pkgDirs it uses)
  const dependents = new Map<string, Set<string>>() // tgt pkgDir → users (pkgDirs that use it)
  const linkWeights = new Map<string, number>() // undirected, for force layout
  for (const e of graph.edges) {
    if (e.kind === 'Contains') continue
    const src = entityToDir.get(e.source)
    const dst = entityToDir.get(e.target)
    if (!src || !dst || src === dst) continue
    // Calls/References imply package dependency (so layer-affecting).
    // Satisfies is structural compatibility, not a dependency; we visualize
    // it but exclude it from the topological layering.
    if (e.kind === 'Calls' || e.kind === 'References') {
      if (!depsOf.has(src)) depsOf.set(src, new Set())
      if (!dependents.has(dst)) dependents.set(dst, new Set())
      depsOf.get(src)!.add(dst)
      dependents.get(dst)!.add(src)
    }
    // Every cross-package edge contributes to the force-layout pull, so
    // satisfied interfaces still gravitate toward their implementers.
    const key = src < dst ? `${src}|${dst}` : `${dst}|${src}`
    linkWeights.set(key, (linkWeights.get(key) ?? 0) + 1)
  }

  // 3. Layer assignment. Sources = packages containing `func main()` in
  // `package main`; if none exist, fall back to packages with zero dependents.
  const allDirs = [...membersByDir.keys()]
  const mainDirs = allDirs.filter((dir) => {
    const members = membersByDir.get(dir) ?? []
    return members.some((m) => m.kind === 'function' && m.name === 'main' && m.package === 'main')
  })
  const sourceSet = new Set(
    mainDirs.length > 0
      ? mainDirs
      : allDirs.filter((d) => (dependents.get(d)?.size ?? 0) === 0),
  )
  const layerOf = computeLayers(allDirs, depsOf, dependents, sourceSet)

  // 4. Build a SimPackage per package node, tagged with its layer.
  const sims: SimPackage[] = graph.nodes
    .filter((n) => n.kind === 'package')
    .map((p) => {
      const count = membersByDir.get(p.package_dir)?.length ?? 0
      return {
        id: p.id,
        packageDir: p.package_dir,
        packageName: p.name,
        memberCount: count,
        radius: cellRadius(count),
        layer: layerOf.get(p.package_dir) ?? 0,
      }
    })

  // forceLink wants its endpoints by node ID — convert the linkWeights map.
  const pkgLinks: SimPackageLink[] = []
  for (const [k, w] of linkWeights) {
    const [a, b] = k.split('|')
    pkgLinks.push({ source: `pkg::${a}`, target: `pkg::${b}`, weight: w })
  }

  // 5. Force-pack with a vertical layer bias. forceY pulls each cell toward
  // its layer's y; forceX gently centers everything horizontally. Together
  // they bias the layout top-down while link/charge/collide handle the
  // organic left/right arrangement within each layer.
  const sim = forceSimulation<SimPackage>(sims)
    .force(
      'link',
      forceLink<SimPackage, SimPackageLink>(pkgLinks)
        .id((d) => d.id)
        .distance(() => 220)
        .strength((d) => Math.min(0.4, 0.04 + d.weight * 0.03)),
    )
    .force(
      'charge',
      forceManyBody<SimPackage>().strength((d) => -50 * d.radius),
    )
    .force('layer-y', forceY<SimPackage>().y((d) => d.layer * LAYER_SPACING).strength(0.5))
    .force('center-x', forceX<SimPackage>(0).strength(0.06))
    .force(
      'collide',
      forceCollide<SimPackage>((d) => d.radius + 40),
    )
    .stop()
  for (let i = 0; i < 400; i++) sim.tick()

  // 5. Per-cell entity layout.
  const packages = new Map<string, PackageCell>()
  const entities = new Map<string, CellPos>()

  for (const p of sims) {
    const members = membersByDir.get(p.packageDir) ?? []
    const { exported, unexported } = partition(members)
    const ordered = membraneOrder(exported, members)

    const cell: PackageCell = {
      packageDir: p.packageDir,
      packageName: p.packageName,
      x: p.x ?? 0,
      y: p.y ?? 0,
      radius: p.radius,
      memberCount: members.length,
      membraneCount: exported.length,
      membrane: ordered,
      cytoplasm: unexported,
    }
    packages.set(p.packageDir, cell)
    repositionCell(cell, entities)
  }

  return { packages, entities }
}

/**
 * Recompute entity positions for one cell. Call after mutating cell.x/y/radius
 * (e.g. during a user drag); entity positions in the shared map are updated
 * in-place, and the render loop picks them up on the next frame.
 */
export function repositionCell(cell: PackageCell, entities: Map<string, CellPos>): void {
  const n = cell.membrane.length
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2
    entities.set(cell.membrane[i].id, {
      x: cell.x + Math.cos(angle) * cell.radius,
      y: cell.y + Math.sin(angle) * cell.radius,
      onMembrane: true,
    })
  }

  const inner = cell.radius * 0.72
  const phi = Math.PI * (3 - Math.sqrt(5))
  const m = cell.cytoplasm.length
  for (let i = 0; i < m; i++) {
    const angle = i * phi
    const r = inner * Math.sqrt((i + 0.5) / m)
    entities.set(cell.cytoplasm[i].id, {
      x: cell.x + Math.cos(angle) * r,
      y: cell.y + Math.sin(angle) * r,
      onMembrane: false,
    })
  }
}

// Topological longest-path layering. layer(node) = max(layer(predecessor)) + 1,
// where "predecessor" means a package that uses this one (so main is layer 0
// and leaves are deepest). Sources get layer 0 explicitly.
function computeLayers(
  allDirs: string[],
  depsOf: Map<string, Set<string>>,
  dependents: Map<string, Set<string>>,
  sources: Set<string>,
): Map<string, number> {
  // Kahn-style topological sort using in-degree on the dependency DAG, where
  // "in-edge of X" = "Y uses X" (so sources — used by nothing — start with 0).
  const inDegree = new Map<string, number>()
  for (const d of allDirs) {
    const fromDependents = dependents.get(d)?.size ?? 0
    // Treat declared sources as zero in-degree even if other packages happen
    // to reference them (rare with main packages, but harmless).
    inDegree.set(d, sources.has(d) ? 0 : fromDependents)
  }
  const queue: string[] = []
  for (const d of allDirs) {
    if ((inDegree.get(d) ?? 0) === 0) queue.push(d)
  }
  const topoOrder: string[] = []
  while (queue.length > 0) {
    const x = queue.shift()!
    topoOrder.push(x)
    for (const succ of depsOf.get(x) ?? []) {
      const next = (inDegree.get(succ) ?? 0) - 1
      inDegree.set(succ, next)
      if (next === 0) queue.push(succ)
    }
  }

  // Any node missed by the topo walk (would only happen if the graph had a
  // cycle, which Go forbids at the package level) gets pinned to layer 0.
  for (const d of allDirs) {
    if (!topoOrder.includes(d)) topoOrder.push(d)
  }

  const layer = new Map<string, number>()
  for (const d of topoOrder) {
    if (sources.has(d)) {
      layer.set(d, 0)
      continue
    }
    let best = 0
    for (const pred of dependents.get(d) ?? []) {
      best = Math.max(best, (layer.get(pred) ?? 0) + 1)
    }
    layer.set(d, best)
  }
  return layer
}

function partition(members: GraphNode[]): { exported: GraphNode[]; unexported: GraphNode[] } {
  const exported: GraphNode[] = []
  const unexported: GraphNode[] = []
  for (const m of members) {
    if (isExported(m.name)) exported.push(m)
    else unexported.push(m)
  }
  return { exported, unexported }
}

// Group exported entities so receiver types and their methods cluster.
// Order: receiver-anchored groups (alpha by type name), each group
// sub-ordered as [type, ...exportedMethods alpha]. Standalone exported
// functions/consts/vars come last.
function membraneOrder(exported: GraphNode[], allMembers: GraphNode[]): GraphNode[] {
  const localTypes = new Set<string>()
  for (const m of allMembers) {
    if (TYPE_KINDS.has(m.kind)) localTypes.add(m.name)
  }

  const groups = new Map<string, GraphNode[]>()
  const standalone: GraphNode[] = []

  for (const e of exported) {
    if (e.kind === 'method') {
      const recv = methodReceiver(e.name)
      if (recv && localTypes.has(recv)) {
        const list = groups.get(recv) ?? []
        list.push(e)
        groups.set(recv, list)
        continue
      }
      standalone.push(e)
      continue
    }
    if (TYPE_KINDS.has(e.kind)) {
      const list = groups.get(e.name) ?? []
      list.push(e)
      groups.set(e.name, list)
      continue
    }
    standalone.push(e)
  }

  const out: GraphNode[] = []
  for (const key of [...groups.keys()].sort()) {
    const items = groups.get(key)!
    items.sort((a, b) => {
      const aType = TYPE_KINDS.has(a.kind)
      const bType = TYPE_KINDS.has(b.kind)
      if (aType !== bType) return aType ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    out.push(...items)
  }
  standalone.sort((a, b) => a.name.localeCompare(b.name))
  out.push(...standalone)
  return out
}
