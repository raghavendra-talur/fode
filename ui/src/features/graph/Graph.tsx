import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import type { GraphNode } from '../../types'
import { layoutCells, repositionCell, type CellLayout, type PackageCell } from './layout'
import PackageFilter from '../../components/PackageFilter'

interface Props {
  repoID: number
  onSelect: (id: string) => void
}

const KIND_COLOR: Record<string, string> = {
  function: '#5fa0e0',
  method: '#a07ad5',
  struct: '#d59a3a',
  interface: '#3ab8a7',
  type: '#9aa',
  const: '#5fc97a',
  var: '#c9b855',
  package: '#fff',
}

const KIND_ORDER = ['function', 'method', 'struct', 'interface', 'type', 'const', 'var']

type EntryRole = 'main' | 'init' | null
function entryRole(n: { kind: string; name: string; package: string }): EntryRole {
  if (n.kind !== 'function') return null
  if (n.name === 'main' && n.package === 'main') return 'main'
  if (n.name === 'init') return 'init'
  return null
}
const ROLE_STROKE: Record<Exclude<EntryRole, null>, string> = {
  main: '#ffd866',
  init: '#ff9f43',
}

function nodeRadius(n: { kind: string; name: string; package: string }, onMembrane: boolean): number {
  const role = entryRole(n)
  if (role === 'main') return 7
  if (role === 'init') return 6
  return onMembrane ? 5 : 4
}

const EDGE_COLOR_CALLS = 'rgba(108,206,255,0.45)'
const EDGE_COLOR_REFERENCES = 'rgba(255,255,255,0.22)'
const EDGE_COLOR_SATISFIES = 'rgba(58,184,167,0.65)'

function edgeColor(kind: string): string {
  if (kind === 'Calls') return EDGE_COLOR_CALLS
  if (kind === 'Satisfies') return EDGE_COLOR_SATISFIES
  return EDGE_COLOR_REFERENCES
}

export default function Graph({ repoID, onSelect }: Props) {
  const graph = useQuery({
    queryKey: ['graph', repoID],
    queryFn: () => api.repoGraph(repoID),
  })

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null)
  const [activeKinds, setActiveKinds] = useState<Set<string>>(new Set())
  const [activePkgs, setActivePkgs] = useState<Set<string>>(new Set())

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    if (graph.data) {
      for (const n of graph.data.nodes) {
        if (n.kind === 'package') continue
        counts[n.kind] = (counts[n.kind] ?? 0) + 1
      }
    }
    return KIND_ORDER.filter((k) => counts[k]).map((k) => ({ kind: k, count: counts[k] }))
  }, [graph.data])

  const packageItems = useMemo(() => {
    if (!graph.data) return []
    const counts = new Map<string, number>()
    for (const n of graph.data.nodes) {
      if (n.kind === 'package') continue
      counts.set(n.package_dir, (counts.get(n.package_dir) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, count]) => ({ dir, count }))
  }, [graph.data])

  // Layout always runs on the FULL graph so positions stay stable across
  // kind-filter toggles. Filtering only affects what we draw, not where
  // things live.
  const layout = useMemo<CellLayout | null>(() => {
    if (!graph.data) return null
    return layoutCells(graph.data)
  }, [graph.data])

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>()
    if (graph.data) for (const n of graph.data.nodes) m.set(n.id, n)
    return m
  }, [graph.data])

  const isVisible = useMemo(() => {
    const kinds = activeKinds
    const pkgs = activePkgs
    return (n: GraphNode) => {
      if (kinds.size > 0 && !kinds.has(n.kind)) return false
      if (pkgs.size > 0 && !pkgs.has(n.package_dir)) return false
      return true
    }
  }, [activeKinds, activePkgs])

  const isCellVisible = useMemo(() => {
    const pkgs = activePkgs
    return (cell: PackageCell) => pkgs.size === 0 || pkgs.has(cell.packageDir)
  }, [activePkgs])

  useEffect(() => {
    if (!layout || !graph.data || !canvasRef.current || !containerRef.current) return

    const canvas = canvasRef.current
    const container = containerRef.current
    const ctx = canvas.getContext('2d')!

    let width = container.clientWidth
    let height = container.clientHeight
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      width = container.clientWidth
      height = container.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    // Fit-to-view on first paint.
    const bounds = computeBounds(layout)
    const initialK = Math.min(width / (bounds.w + 120), height / (bounds.h + 120), 1)
    const transform = {
      x: width / 2 - bounds.cx * initialK,
      y: height / 2 - bounds.cy * initialK,
      k: initialK,
    }

    const screenToWorld = (sx: number, sy: number) => ({
      x: (sx - transform.x) / transform.k,
      y: (sy - transform.y) / transform.k,
    })

    // Mouse interaction state machine. At mousedown we classify the press
    // by what's under the cursor: entity → potential click; cell → cell drag;
    // background → viewport pan. An entity press auto-promotes to viewport
    // pan if the mouse moves before mouseup.
    type Mode =
      | { kind: 'idle' }
      | { kind: 'entity'; entity: GraphNode }
      | { kind: 'cell'; cell: PackageCell }
      | { kind: 'pan' }
    let mode: Mode = { kind: 'idle' }
    let lastClient = { x: 0, y: 0 }
    let totalMoved = 0

    const hitEntity = (worldX: number, worldY: number): GraphNode | null => {
      let best: GraphNode | null = null
      let bestDist = Infinity
      for (const [id, pos] of layout.entities) {
        const node = nodeById.get(id)
        if (!node || !isVisible(node)) continue
        const r = nodeRadius(node, pos.onMembrane) + 3
        const dx = pos.x - worldX
        const dy = pos.y - worldY
        const d2 = dx * dx + dy * dy
        if (d2 < r * r && d2 < bestDist) {
          best = node
          bestDist = d2
        }
      }
      return best
    }

    const hitCell = (worldX: number, worldY: number): PackageCell | null => {
      let best: PackageCell | null = null
      let bestDist = Infinity
      for (const cell of layout.packages.values()) {
        if (!isCellVisible(cell)) continue
        const dx = cell.x - worldX
        const dy = cell.y - worldY
        const d2 = dx * dx + dy * dy
        if (d2 < cell.radius * cell.radius && d2 < bestDist) {
          best = cell
          bestDist = d2
        }
      }
      return best
    }

    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
      const entity = hitEntity(w.x, w.y)
      if (entity) {
        mode = { kind: 'entity', entity }
      } else {
        const cell = hitCell(w.x, w.y)
        mode = cell ? { kind: 'cell', cell } : { kind: 'pan' }
      }
      lastClient = { x: e.clientX, y: e.clientY }
      totalMoved = 0
      if (mode.kind === 'cell' || mode.kind === 'pan') {
        canvas.style.cursor = 'grabbing'
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (mode.kind !== 'idle') {
        const dx = e.clientX - lastClient.x
        const dy = e.clientY - lastClient.y
        lastClient = { x: e.clientX, y: e.clientY }
        totalMoved += Math.abs(dx) + Math.abs(dy)

        // An entity press becomes a viewport pan once the user moves.
        if (mode.kind === 'entity' && totalMoved > 3) {
          mode = { kind: 'pan' }
          canvas.style.cursor = 'grabbing'
        }

        if (mode.kind === 'cell') {
          // Screen→world scaling: divide by zoom.
          mode.cell.x += dx / transform.k
          mode.cell.y += dy / transform.k
          repositionCell(mode.cell, layout.entities)
        } else if (mode.kind === 'pan') {
          transform.x += dx
          transform.y += dy
        }
        return
      }

      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const w = screenToWorld(sx, sy)
      const node = hitEntity(w.x, w.y)
      if (node) {
        setHover({ text: `${node.kind}  ${node.name}`, x: sx + 12, y: sy + 12 })
        canvas.style.cursor = 'pointer'
        return
      }
      setHover(null)
      canvas.style.cursor = hitCell(w.x, w.y) ? 'grab' : 'grab'
    }

    const onMouseUp = (e: MouseEvent) => {
      const wasClick = mode.kind === 'entity' && totalMoved < 3
      const target = mode.kind === 'entity' ? mode.entity : null
      mode = { kind: 'idle' }
      canvas.style.cursor = 'grab'
      if (wasClick && target) {
        // Sanity re-check at the release point.
        const rect = canvas.getBoundingClientRect()
        const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
        if (hitEntity(w.x, w.y) === target) onSelect(target.id)
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const w = screenToWorld(sx, sy)
      const factor = Math.exp(-e.deltaY * 0.001)
      transform.k = Math.max(0.05, Math.min(8, transform.k * factor))
      transform.x = sx - w.x * transform.k
      transform.y = sy - w.y * transform.k
    }

    const onLeave = () => {
      setHover(null)
      canvas.style.cursor = 'grab'
    }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mouseleave', onLeave)

    let raf = 0
    const render = () => {
      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)
      ctx.translate(transform.x, transform.y)
      ctx.scale(transform.k, transform.k)

      // 1. Cells: filled disc + membrane ring + label.
      for (const cell of layout.packages.values()) {
        if (!isCellVisible(cell)) continue
        ctx.fillStyle = 'rgba(108, 206, 255, 0.04)'
        ctx.beginPath()
        ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2)
        ctx.fill()

        ctx.strokeStyle = 'rgba(255,255,255,0.22)'
        ctx.lineWidth = 1.5 / transform.k
        ctx.stroke()

        ctx.fillStyle = '#fff'
        ctx.font = `${Math.max(11, 13 / transform.k)}px ui-sans-serif, system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(cell.packageDir, cell.x, cell.y - cell.radius - 6)
      }

      // 2. Edges — skip Contains (the cell encloses members visually).
      // Satisfies edges get a dashed pattern so they read as structural
      // typing (not a call) without inventing new geometry.
      ctx.lineWidth = 1 / transform.k
      const dashOn = 4 / transform.k
      const dashOff = 3 / transform.k
      for (const e of graph.data!.edges) {
        if (e.kind === 'Contains') continue
        const sNode = nodeById.get(e.source)
        const tNode = nodeById.get(e.target)
        if (!sNode || !tNode) continue
        if (!isVisible(sNode) || !isVisible(tNode)) continue
        const sPos = layout.entities.get(e.source)
        const tPos = layout.entities.get(e.target)
        if (!sPos || !tPos) continue
        ctx.strokeStyle = edgeColor(e.kind)
        if (e.kind === 'Satisfies') {
          ctx.setLineDash([dashOn, dashOff])
        } else {
          ctx.setLineDash([])
        }
        ctx.beginPath()
        ctx.moveTo(sPos.x, sPos.y)
        ctx.lineTo(tPos.x, tPos.y)
        ctx.stroke()
      }
      ctx.setLineDash([])

      // 3. Entities on top.
      const labelFont = `${Math.max(9, 10 / transform.k)}px ui-sans-serif, system-ui`
      for (const [id, pos] of layout.entities) {
        const node = nodeById.get(id)
        if (!node || !isVisible(node)) continue
        const r = nodeRadius(node, pos.onMembrane)
        const role = entryRole(node)

        ctx.fillStyle = KIND_COLOR[node.kind] ?? '#888'
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
        ctx.fill()

        if (role) {
          ctx.strokeStyle = ROLE_STROKE[role]
          ctx.lineWidth = 2 / transform.k
          ctx.stroke()

          ctx.fillStyle = ROLE_STROKE[role]
          ctx.font = labelFont
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(role === 'main' ? 'main()' : 'init()', pos.x, pos.y + r + 2)
        }
      }

      ctx.restore()
      raf = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mouseleave', onLeave)
    }
  }, [layout, graph.data, nodeById, isVisible, isCellVisible, onSelect])

  const toggleKind = (k: string) => {
    setActiveKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const togglePkg = (d: string) => {
    setActivePkgs((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })
  }

  if (graph.isLoading) return <p className="muted">Loading graph…</p>
  if (graph.error)
    return <p className="error">{(graph.error as Error).message}</p>

  return (
    <div className="graph-wrap" ref={containerRef}>
      <canvas ref={canvasRef} />
      <div className="graph-filters-overlay">
        <div className="filter-row">
          <span className="filter-label muted">kind</span>
          {kindCounts.map((k) => (
            <button
              key={k.kind}
              className={`chip graph-chip ${activeKinds.has(k.kind) ? 'chip-active' : ''}`}
              onClick={() => toggleKind(k.kind)}
              title={`${k.kind} (${k.count})`}
            >
              <span className="graph-chip-swatch" style={{ background: KIND_COLOR[k.kind] }} />
              {k.kind} <span className="muted">{k.count}</span>
            </button>
          ))}
          {activeKinds.size > 0 ? (
            <button
              className="chip graph-chip graph-chip-clear"
              onClick={() => setActiveKinds(new Set())}
            >
              clear
            </button>
          ) : null}
        </div>
        <div className="filter-row">
          <span className="filter-label muted">package</span>
          <PackageFilter
            items={packageItems}
            active={activePkgs}
            onToggle={togglePkg}
            onClear={() => setActivePkgs(new Set())}
            className="graph-pkg-filter"
          />
        </div>
      </div>
      {hover ? (
        <div className="graph-tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.text}
        </div>
      ) : null}
      <div className="graph-legend">
        <span className="role-marker role-main" /> main
        <span className="role-marker role-init" /> init
        <span className="edge-marker edge-marker-satisfies" /> satisfies
        <span className="muted">
          · wall = exported · inside = unexported · drag · scroll · click dot to focus
        </span>
      </div>
    </div>
  )
}

function computeBounds(layout: CellLayout): { w: number; h: number; cx: number; cy: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const cell of layout.packages.values()) {
    minX = Math.min(minX, cell.x - cell.radius)
    minY = Math.min(minY, cell.y - cell.radius)
    maxX = Math.max(maxX, cell.x + cell.radius)
    maxY = Math.max(maxY, cell.y + cell.radius)
  }
  if (!isFinite(minX)) return { w: 100, h: 100, cx: 0, cy: 0 }
  return {
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  }
}
