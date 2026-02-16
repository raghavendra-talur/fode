// === Tauri IPC bridge ===
const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;

// === DOM refs ===
const $landing = document.getElementById('landing');
const $main = document.getElementById('main');
const $openRepoBtn = document.getElementById('open-repo-btn');
const $repoName = document.getElementById('repo-name');
const $repoAttributes = document.getElementById('repo-attributes');
const $repoStats = document.getElementById('repo-stats');
const $searchInput = document.getElementById('search-input');
const $searchResults = document.getElementById('search-results');
const $focusContainer = document.getElementById('focus-container');
const $relatedIncoming = document.getElementById('related-incoming');
const $centerEntity = document.getElementById('center-entity');
const $relatedOutgoing = document.getElementById('related-outgoing');
const $browseContainer = document.getElementById('browse-container');
const $entityGrid = document.getElementById('entity-grid');

// === Additional DOM refs for graph ===
const $viewControls = document.getElementById('view-controls');
const $btnGridView = document.getElementById('btn-grid-view');
const $btnGraphView = document.getElementById('btn-graph-view');
const $graphContainer = document.getElementById('graph-container');
const $graphCanvas = document.getElementById('graph-canvas');
const $graphTooltip = document.getElementById('graph-tooltip');
const $graphFilters = document.getElementById('graph-filters');
const $kindFilters = document.getElementById('kind-filters');
const $pkgDropdownBtn = document.getElementById('pkg-dropdown-btn');
const $pkgDropdownCount = document.getElementById('pkg-dropdown-count');
const $pkgDropdownMenu = document.getElementById('pkg-dropdown-menu');
const $pkgDropdownList = document.getElementById('pkg-dropdown-list');

// === State ===
let repoInfo = null;
let searchTimeout = null;
let currentView = 'grid'; // 'grid' or 'graph'
let graphState = null; // holds the force simulation state

// === Helpers ===
function kindBadge(kind) {
  const labels = {
    Function: 'fn', Method: 'me', Struct: 'st', Interface: 'if',
    TypeAlias: 'ty', Constant: 'co', Variable: 'va', Import: 'im',
    Package: 'pk', Class: 'cl', Enum: 'en', Trait: 'tr', Module: 'mo',
  };
  const classes = {
    Function: 'kind-function', Method: 'kind-method', Struct: 'kind-struct',
    Interface: 'kind-interface', TypeAlias: 'kind-type', Constant: 'kind-const',
    Variable: 'kind-var', Import: 'kind-import', Package: 'kind-package',
    Class: 'kind-class', Enum: 'kind-enum', Trait: 'kind-trait', Module: 'kind-module',
  };
  const label = labels[kind] || '??';
  const cls = classes[kind] || '';
  return `<span class="entity-kind-badge ${cls}">${label}</span>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showView(name) {
  $landing.classList.toggle('active', name === 'landing');
  $main.classList.toggle('active', name === 'main');
}

// === Open Repo ===
async function openRepo() {
  const selected = await open({ directory: true, multiple: false, title: 'Open Repository' });
  if (!selected) return;

  showView('main');
  $entityGrid.innerHTML = '<div class="loading">Parsing repository</div>';
  $focusContainer.classList.add('hidden');
  $browseContainer.style.display = '';
  $graphContainer.classList.add('hidden');
  $viewControls.classList.remove('hidden');
  graphState = null; // reset graph on new repo
  currentView = 'grid';
  $btnGridView.classList.add('active');
  $btnGraphView.classList.remove('active');
  $graphFilters.classList.add('hidden');

  try {
    repoInfo = await invoke('open_repo', { path: selected });
    renderRepoHeader(repoInfo);
    await loadBrowseView();
  } catch (err) {
    $browseContainer.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${escapeHtml(String(err))}</div>`;
  }
}

// === Render Repo Header ===
function renderRepoHeader(info) {
  $repoName.textContent = info.name;

  $repoAttributes.innerHTML = info.attributes.map(attr => {
    const value = attr.link
      ? `<a href="#" onclick="return false">${escapeHtml(attr.value)}</a>`
      : `<span class="attr-value">${escapeHtml(attr.value)}</span>`;
    return `<span class="attr-badge"><span class="attr-label">${escapeHtml(attr.label)}</span> ${value}</span>`;
  }).join('');

  $repoStats.innerHTML = `
    <span>${info.language}</span>
    <span>${info.total_files} files</span>
    <span>${info.total_entities} entities</span>
  `;
}

// === Browse View (grid of all entities) ===
async function loadBrowseView() {
  try {
    const entities = await invoke('get_all_entities');
    renderEntityGrid(entities);
  } catch (err) {
    $entityGrid.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${escapeHtml(String(err))}</div>`;
  }
}

function renderEntityGrid(entities) {
  $entityGrid.innerHTML = entities.map(e => `
    <div class="entity-card" data-id="${escapeHtml(e.id)}" onclick="focusEntity('${escapeHtml(e.id)}')">
      <div class="entity-card-header">
        ${kindBadge(e.kind)}
        <span class="entity-card-name">${escapeHtml(e.name)}</span>
        <span class="entity-card-meta">${escapeHtml(e.package)}</span>
      </div>
      <div class="entity-card-sig">${escapeHtml(e.signature)}</div>
    </div>
  `).join('');
}

// === Search ===
$searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const query = $searchInput.value.trim();
  if (query.length === 0) {
    $searchResults.classList.add('hidden');
    return;
  }
  searchTimeout = setTimeout(() => doSearch(query), 120);
});

$searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $searchResults.classList.add('hidden');
    $searchInput.blur();
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const first = $searchResults.querySelector('.search-result-item');
    if (first) first.focus();
  }
});

// Close search results on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-container')) {
    $searchResults.classList.add('hidden');
  }
});

async function doSearch(query) {
  try {
    const results = await invoke('search_entities', { query });
    renderSearchResults(results);
  } catch (err) {
    console.error('Search error:', err);
  }
}

function renderSearchResults(results) {
  if (results.length === 0) {
    $searchResults.innerHTML = '<div class="search-result-item" style="color:var(--text-dim);cursor:default">No results</div>';
    $searchResults.classList.remove('hidden');
    return;
  }

  $searchResults.innerHTML = results.map(r => `
    <div class="search-result-item" tabindex="0"
         onclick="focusEntity('${escapeHtml(r.entity.id)}')"
         onkeydown="if(event.key==='Enter')focusEntity('${escapeHtml(r.entity.id)}')">
      ${kindBadge(r.entity.kind)}
      <span class="result-name">${escapeHtml(r.entity.name)}</span>
      <span class="result-meta">${escapeHtml(r.entity.package)} &middot; ${escapeHtml(r.entity.file)}</span>
    </div>
  `).join('');
  $searchResults.classList.remove('hidden');
}

// === Focus View ===
async function focusEntity(entityId) {
  $searchResults.classList.add('hidden');
  $searchInput.value = '';
  $browseContainer.style.display = 'none';
  $graphContainer.classList.add('hidden');
  $focusContainer.classList.remove('hidden');

  try {
    const focus = await invoke('get_entity_focus', { entityId });
    renderFocusView(focus);
  } catch (err) {
    $centerEntity.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${escapeHtml(String(err))}</div>`;
  }
}

// Make focusEntity available globally for onclick handlers
window.focusEntity = focusEntity;

function renderFocusView(focus) {
  const { center, incoming, same_pkg, same_module, external_deps } = focus;

  // Center entity
  $centerEntity.innerHTML = `
    <div class="center-entity-header">
      ${kindBadge(center.kind)}
      <span class="center-entity-name">${escapeHtml(center.name)}</span>
      <span class="center-entity-meta">${escapeHtml(center.package)} &middot; ${escapeHtml(center.file)}:${center.line}</span>
      <button class="back-btn" onclick="showBrowse()">back</button>
    </div>
    ${center.doc_comment ? `<div class="center-entity-doc">${escapeHtml(center.doc_comment)}</div>` : ''}
    <div class="center-entity-source"><pre>${escapeHtml(center.source)}</pre></div>
  `;

  // Left column: incoming references
  $relatedIncoming.innerHTML = '';
  if (incoming.length > 0) {
    $relatedIncoming.innerHTML = `<div class="related-section-label">referenced by</div>` +
      incoming.map(r => `
        <div class="related-card" onclick="focusEntity('${escapeHtml(r.entity.id)}')">
          <div class="related-card-header">
            ${kindBadge(r.entity.kind)}
            <span class="related-card-name">${escapeHtml(r.entity.name)}</span>
          </div>
          <div class="related-card-relation">${escapeHtml(r.relation)}</div>
          <div class="related-card-sig">${escapeHtml(r.entity.signature)}</div>
        </div>
      `).join('');
  }

  // Right column: three-tier references
  $relatedOutgoing.innerHTML = '';

  // Tier 1: Same package — compact signature-only entries
  if (same_pkg.length > 0) {
    $relatedOutgoing.innerHTML += `<div class="related-section-label">same package</div>` +
      same_pkg.map(e => `
        <div class="compact-sig" onclick="focusEntity('${escapeHtml(e.id)}')">
          ${escapeHtml(e.signature)}
        </div>
      `).join('');
  }

  // Tier 2: Same module, different package — grouped summaries
  if (same_module.length > 0) {
    $relatedOutgoing.innerHTML += `<div class="related-section-label">module packages</div>` +
      same_module.map(g => {
        const parts = [];
        if (g.fn_count > 0) parts.push(`${g.fn_count} function${g.fn_count > 1 ? 's' : ''}`);
        if (g.type_count > 0) parts.push(`${g.type_count} type${g.type_count > 1 ? 's' : ''}`);
        return `
          <div class="pkg-summary">
            <span class="pkg-summary-count">${parts.join(', ')}</span>
            <span class="pkg-summary-label"> in <strong>${escapeHtml(g.pkg_name)}</strong></span>
            <span class="pkg-summary-dir">${escapeHtml(g.pkg_dir)}</span>
          </div>
        `;
      }).join('');
  }

  // Tier 3: External dependencies — just the import path
  if (external_deps.length > 0) {
    $relatedOutgoing.innerHTML += `<div class="related-section-label">external deps</div>` +
      external_deps.map(dep => `
        <div class="ext-dep">${escapeHtml(dep)}</div>
      `).join('');
  }
}

function showBrowse() {
  $focusContainer.classList.add('hidden');
  if (currentView === 'grid') {
    $browseContainer.style.display = '';
    $graphContainer.classList.add('hidden');
  } else {
    $browseContainer.style.display = 'none';
    $graphContainer.classList.remove('hidden');
  }
}
window.showBrowse = showBrowse;

// === View Toggle ===
function switchToGrid() {
  currentView = 'grid';
  $btnGridView.classList.add('active');
  $btnGraphView.classList.remove('active');
  $browseContainer.style.display = '';
  $graphContainer.classList.add('hidden');
  $graphFilters.classList.add('hidden');
}
window.switchToGrid = switchToGrid;

function switchToGraph() {
  currentView = 'graph';
  $btnGraphView.classList.add('active');
  $btnGridView.classList.remove('active');
  $browseContainer.style.display = 'none';
  $graphContainer.classList.remove('hidden');
  $graphFilters.classList.remove('hidden');
  $focusContainer.classList.add('hidden');
  loadGraphView();
}
window.switchToGraph = switchToGraph;

// ============================================================
// === GRAPH ENGINE — Obsidian-quality force-directed graph ===
// ============================================================

const KIND_COLORS = {
  function:  '#58a6ff', method:    '#bc8cff', struct:    '#3fb950',
  interface: '#d29922', type:      '#d29922', const:     '#f85149',
  var:       '#f778ba', import:    '#76e3ea', package:   '#76e3ea',
  class:     '#3fb950', enum:      '#d29922', trait:     '#d29922',
  module:    '#76e3ea',
};

const KIND_LABELS = {
  function: 'fn', method: 'me', struct: 'st', interface: 'if',
  type: 'ty', const: 'co', var: 'va', import: 'im',
  package: 'pk', class: 'cl', enum: 'en', trait: 'tr', module: 'mo',
};

// Precompute RGB channels for each kind color
const KIND_RGB = {};
for (const [k, hex] of Object.entries(KIND_COLORS)) {
  KIND_RGB[k] = {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// === Load / Init ===
async function loadGraphView() {
  if (graphState && graphState.graphData) {
    // Already loaded — resume the render loop
    if (!graphState.animating) startRenderLoop();
    return;
  }
  try {
    const data = await invoke('get_graph_data');
    initGraph(data);
  } catch (err) {
    console.error('Graph load error:', err);
  }
}

function graphRedraw() {
  graphState = null;
  loadGraphView();
}
window.graphRedraw = graphRedraw;

function initGraph(data) {
  const canvas = $graphCanvas;
  const rect = $graphContainer.getBoundingClientRect();
  const width = rect.width || window.innerWidth;
  const height = rect.height || (window.innerHeight - 200);
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  // --- Build nodes ---
  const nodeMap = new Map();
  const nodes = data.nodes.map(n => {
    const node = {
      ...n,
      x: 0, y: 0, vx: 0, vy: 0,
      radius: 4,
      visible: true,
      pinned: false,       // stays in place after drag
      highlightAlpha: 0,   // animated highlight intensity (0..1)
    };
    nodeMap.set(n.id, node);
    return node;
  });

  // --- Build edges + adjacency ---
  const edges = [];
  const adjOut = new Map(); // id -> Set<id>
  const adjIn  = new Map(); // id -> Set<id>
  for (const e of data.edges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    edges.push({ source: s, target: t, kind: e.kind });
    if (!adjOut.has(s.id)) adjOut.set(s.id, new Set());
    adjOut.get(s.id).add(t.id);
    if (!adjIn.has(t.id)) adjIn.set(t.id, new Set());
    adjIn.get(t.id).add(s.id);
  }

  // Degree & radius
  const degree = new Map();
  edges.forEach(e => {
    degree.set(e.source.id, (degree.get(e.source.id) || 0) + 1);
    degree.set(e.target.id, (degree.get(e.target.id) || 0) + 1);
  });
  nodes.forEach(n => {
    const d = degree.get(n.id) || 0;
    if (n.kind === 'package') {
      n.radius = Math.max(10, Math.min(22, 10 + Math.sqrt(d) * 1.2));
    } else {
      n.radius = Math.max(3, Math.min(14, 3 + Math.sqrt(d) * 1.8));
    }
  });

  // --- Package clustering: initial placement ---
  const pkgSet = [...new Set(nodes.map(n => n.package))];
  const pkgCenters = new Map();
  const clusterRadius = Math.min(width, height) * 0.32;
  pkgSet.forEach((pkg, i) => {
    const angle = (2 * Math.PI * i) / pkgSet.length;
    pkgCenters.set(pkg, {
      x: width / 2 + Math.cos(angle) * clusterRadius,
      y: height / 2 + Math.sin(angle) * clusterRadius,
    });
  });
  nodes.forEach(n => {
    const c = pkgCenters.get(n.package);
    if (c) {
      n.x = c.x + (Math.random() - 0.5) * 100;
      n.y = c.y + (Math.random() - 0.5) * 100;
    } else {
      n.x = width / 2 + (Math.random() - 0.5) * width * 0.5;
      n.y = height / 2 + (Math.random() - 0.5) * height * 0.5;
    }
  });

  // --- Filters ---
  setupFilters(data.package_info || data.packages.map(p => ({ name: p, dir: p, full_path: p })), nodes);

  // Apply initial filter state (some kinds may be disabled by default)
  {
    const activeKinds = new Set();
    $kindFilters.querySelectorAll('.filter-chip.active').forEach(c => activeKinds.add(c.dataset.kind));
    const activePkgs = new Set();
    $pkgDropdownList.querySelectorAll('input[type="checkbox"]:checked').forEach(c => activePkgs.add(c.dataset.pkg));
    nodes.forEach(n => {
      n.visible = activeKinds.has(n.kind) && activePkgs.has(n.package);
    });
  }

  // --- Graph state ---
  graphState = {
    nodes, edges, nodeMap, adjOut, adjIn,
    ctx, canvas, width, height, pkgCenters,
    graphData: data,
    animating: false,

    // Camera
    transform: { x: 0, y: 0, k: 1 },
    targetTransform: { x: 0, y: 0, k: 1 }, // for smooth zoom

    // Simulation
    alpha: 1.0,
    alphaTarget: 0.0,    // non-zero = never fully stops (set to ~0.02 for "breathing")
    alphaDecay: 0.02,
    alphaMin: 0.001,
    velocityDecay: 0.55, // lower = more damping, 0.4-0.6 feels organic

    // Interaction
    hoveredNode: null,
    selectedNode: null,   // persisted click selection
    dragging: null,
  };

  setupCanvasInteraction(canvas);
  startRenderLoop();

  // Auto-fit once the simulation has settled a bit
  setTimeout(() => graphFitToScreen(), 800);
  setTimeout(() => graphFitToScreen(), 2000);
}

// === Render loop (always running while graph is visible) ===
function startRenderLoop() {
  if (graphState.animating) return;
  graphState.animating = true;
  let lastTime = performance.now();
  function loop(now) {
    if (!graphState || currentView !== 'graph') {
      graphState.animating = false;
      return;
    }
    const dt = Math.min((now - lastTime) / 16.667, 2.0); // normalized to 60fps, capped
    lastTime = now;

    tickSimulation(dt);
    tickAnimations(dt);
    smoothZoom(dt);
    renderGraph();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// === PHYSICS (spatial-grid accelerated) ===

// Reusable spatial grid to avoid per-frame allocation
const _grid = { cells: new Map(), cellSize: 0 };

function _gridClear(cellSize) {
  _grid.cells.clear();
  _grid.cellSize = cellSize;
}

function _gridInsert(node) {
  const cs = _grid.cellSize;
  const key = ((node.x / cs | 0) * 73856093) ^ ((node.y / cs | 0) * 19349663);
  let bucket = _grid.cells.get(key);
  if (!bucket) { bucket = []; _grid.cells.set(key, bucket); }
  bucket.push(node);
}

function _gridNeighborKeys(x, y) {
  const cs = _grid.cellSize;
  const cx = x / cs | 0, cy = y / cs | 0;
  const keys = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      keys.push(((cx + dx) * 73856093) ^ ((cy + dy) * 19349663));
    }
  }
  return keys;
}

function tickSimulation(dt) {
  const { nodes, edges, pkgCenters, width, height } = graphState;

  // Alpha cooling toward target
  const alphaDiff = graphState.alphaTarget - graphState.alpha;
  graphState.alpha += alphaDiff * graphState.alphaDecay * dt;
  if (Math.abs(graphState.alpha) < graphState.alphaMin && graphState.alphaTarget === 0) {
    graphState.alpha = 0;
  }
  if (graphState.alpha <= 0) return;

  const alpha = graphState.alpha;
  const visibleNodes = [];
  for (const n of nodes) {
    if (n.visible) visibleNodes.push(n);
  }
  const visibleSet = new Set();
  for (const n of visibleNodes) visibleSet.add(n.id);
  const N = visibleNodes.length;

  // 1. Many-body repulsion via spatial grid (O(n) amortized instead of O(n²))
  const repulsion = -200;
  const cutoff = N > 800 ? 250 : 500;
  const cutoffSq = cutoff * cutoff;
  _gridClear(cutoff);
  for (const n of visibleNodes) _gridInsert(n);

  for (const n of visibleNodes) {
    if (n.pinned) continue;
    const nkeys = _gridNeighborKeys(n.x, n.y);
    for (const key of nkeys) {
      const bucket = _grid.cells.get(key);
      if (!bucket) continue;
      for (const m of bucket) {
        if (m.id <= n.id) continue; // avoid double-counting (lexicographic)
        const dx = m.x - n.x;
        const dy = m.y - n.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > cutoffSq) continue;
        const dist = Math.sqrt(distSq) || 0.5;
        const strength = repulsion * alpha / (dist * dist);
        const fx = (dx / dist) * strength;
        const fy = (dy / dist) * strength;
        if (!n.pinned) { n.vx -= fx; n.vy -= fy; }
        if (!m.pinned) { m.vx += fx; m.vy += fy; }
      }
    }
  }

  // 2. Link spring force
  const linkDist = 80;
  const linkStrength = 0.08;
  for (const e of edges) {
    if (!visibleSet.has(e.source.id) || !visibleSet.has(e.target.id)) continue;
    let dx = e.target.x - e.source.x;
    let dy = e.target.y - e.source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.5;
    const displacement = dist - linkDist;
    const strength = displacement * linkStrength * alpha;
    const fx = (dx / dist) * strength;
    const fy = (dy / dist) * strength;
    if (!e.source.pinned) { e.source.vx += fx; e.source.vy += fy; }
    if (!e.target.pinned) { e.target.vx -= fx; e.target.vy -= fy; }
  }

  // 3. Collision via spatial grid (O(n) amortized instead of O(n²))
  const collisionCell = 40;
  _gridClear(collisionCell);
  for (const n of visibleNodes) _gridInsert(n);

  for (const n of visibleNodes) {
    const nkeys = _gridNeighborKeys(n.x, n.y);
    for (const key of nkeys) {
      const bucket = _grid.cells.get(key);
      if (!bucket) continue;
      for (const m of bucket) {
        if (m.id <= n.id) continue;
        const dx = m.x - n.x;
        const dy = m.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.5;
        const minDist = n.radius + m.radius + 2;
        if (dist < minDist) {
          const overlap = (minDist - dist) * 0.5;
          const nx2 = dx / dist;
          const ny2 = dy / dist;
          if (!n.pinned) { n.x -= nx2 * overlap; n.y -= ny2 * overlap; }
          if (!m.pinned) { m.x += nx2 * overlap; m.y += ny2 * overlap; }
        }
      }
    }
  }

  // 4. Package clustering (gentle)
  const clusterStr = 0.06;
  for (const n of visibleNodes) {
    if (n.pinned) continue;
    const c = pkgCenters.get(n.package);
    if (c) {
      n.vx += (c.x - n.x) * clusterStr * alpha;
      n.vy += (c.y - n.y) * clusterStr * alpha;
    }
  }

  // 5. Center gravity (soft)
  const cx = width / 2, cy = height / 2;
  const gravity = 0.015;
  for (const n of visibleNodes) {
    if (n.pinned) continue;
    n.vx += (cx - n.x) * gravity * alpha;
    n.vy += (cy - n.y) * gravity * alpha;
  }

  // 6. Integrate (Velocity Verlet-ish: apply velocity with damping)
  const decay = graphState.velocityDecay;
  for (const n of visibleNodes) {
    if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
    n.vx *= decay;
    n.vy *= decay;
    n.x += n.vx * dt;
    n.y += n.vy * dt;
  }
}

// === Smooth per-node highlight animation ===
function tickAnimations(dt) {
  const { nodes, edges, hoveredNode, selectedNode } = graphState;
  const activeNode = hoveredNode || selectedNode;
  const connectedSet = new Set();
  if (activeNode) {
    connectedSet.add(activeNode.id);
    for (const e of edges) {
      if (e.source.id === activeNode.id) connectedSet.add(e.target.id);
      if (e.target.id === activeNode.id) connectedSet.add(e.source.id);
    }
  }

  const speed = 0.12 * dt; // animation speed
  for (const n of nodes) {
    if (!n.visible) continue;
    const target = activeNode ? (connectedSet.has(n.id) ? 1.0 : 0.0) : 1.0;
    n.highlightAlpha += (target - n.highlightAlpha) * speed;
    // clamp
    if (n.highlightAlpha < 0.01) n.highlightAlpha = 0;
    if (n.highlightAlpha > 0.99) n.highlightAlpha = 1;
  }
}

// === Smooth animated zoom ===
function smoothZoom(dt) {
  const t = graphState.transform;
  const tt = graphState.targetTransform;
  const lerp = 0.18 * dt;
  t.x += (tt.x - t.x) * lerp;
  t.y += (tt.y - t.y) * lerp;
  t.k += (tt.k - t.k) * lerp;
  // snap when close
  if (Math.abs(tt.k - t.k) < 0.001) t.k = tt.k;
  if (Math.abs(tt.x - t.x) < 0.1) t.x = tt.x;
  if (Math.abs(tt.y - t.y) < 0.1) t.y = tt.y;
}

// === RENDERING ===
function renderGraph() {
  if (!graphState) return;
  const { ctx, nodes, edges, width, height, transform, hoveredNode, selectedNode } = graphState;
  const activeNode = hoveredNode || selectedNode;
  const dpr = window.devicePixelRatio;
  const k = transform.k;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.translate(transform.x, transform.y);
  ctx.scale(k, k);

  // Pre-build connected set for active node
  const connectedSet = new Set();
  if (activeNode) {
    connectedSet.add(activeNode.id);
    for (const e of edges) {
      if (e.source.id === activeNode.id) connectedSet.add(e.target.id);
      if (e.target.id === activeNode.id) connectedSet.add(e.source.id);
    }
  }

  // --- 1. Draw edges (base layer) ---
  ctx.lineCap = 'round';
  for (const e of edges) {
    if (!e.source.visible || !e.target.visible) continue;

    const isHighlighted = activeNode && (
      e.source.id === activeNode.id || e.target.id === activeNode.id
    );

    if (isHighlighted) continue; // draw highlighted edges on top

    const avgAlpha = (e.source.highlightAlpha + e.target.highlightAlpha) / 2;
    const edgeAlpha = activeNode ? avgAlpha * 0.2 + 0.03 : 0.12;

    ctx.strokeStyle = `rgba(136,152,170,${edgeAlpha})`;
    ctx.lineWidth = 0.6 / k;
    ctx.beginPath();
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
    ctx.stroke();
  }

  // --- 2. Draw highlighted edges ---
  if (activeNode) {
    for (const e of edges) {
      if (!e.source.visible || !e.target.visible) continue;
      if (e.source.id !== activeNode.id && e.target.id !== activeNode.id) continue;

      // Use the color of the "other" end for variety
      const other = e.source.id === activeNode.id ? e.target : e.source;
      const color = KIND_COLORS[other.kind] || '#8b949e';
      ctx.strokeStyle = hexToRgba(color, 0.45);
      ctx.lineWidth = 1.2 / k;
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
    }
  }

  // --- 3. Draw node glow + body ---
  for (const n of nodes) {
    if (!n.visible) continue;
    const color = KIND_COLORS[n.kind] || '#8b949e';
    const rgb = KIND_RGB[n.kind] || { r: 139, g: 148, b: 158 };
    const isActive = activeNode && activeNode.id === n.id;
    const isConnected = connectedSet.has(n.id);
    const ha = n.highlightAlpha;
    const r = n.radius;
    const screenR = r; // radius in world coords

    // Glow (radial gradient) — only for highlighted or when no selection
    if (ha > 0.3) {
      const glowR = screenR * (isActive ? 4 : 2.5);
      const glowAlpha = ha * (isActive ? 0.35 : 0.15);
      const grad = ctx.createRadialGradient(n.x, n.y, screenR * 0.5, n.x, n.y, glowR);
      grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${glowAlpha})`);
      grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Node body
    const bodyAlpha = activeNode
      ? (isActive ? 1.0 : (isConnected ? 0.9 : 0.08 + ha * 0.1))
      : 0.85;
    const scale = isActive ? 1.35 : (isConnected && activeNode ? 1.1 : 1.0);
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${bodyAlpha})`;
    ctx.beginPath();
    if (n.kind === 'package') {
      // Draw hexagon for package nodes
      const hr = screenR * scale;
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + (Math.PI * 2 * i) / 6;
        const px = n.x + Math.cos(angle) * hr;
        const py = n.y + Math.sin(angle) * hr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.arc(n.x, n.y, screenR * scale, 0, Math.PI * 2);
    }
    ctx.fill();

    // White ring on active/selected
    if (isActive) {
      ctx.strokeStyle = `rgba(255,255,255,0.8)`;
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();
    }

    // Pin indicator
    if (n.pinned) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.5 / k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- 4. Labels ---
  const showAllLabels = k > 0.8;
  const fontSize = Math.max(8, Math.min(12, 10 / k));
  ctx.font = `500 ${fontSize}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';

  for (const n of nodes) {
    if (!n.visible) continue;

    const isActive = activeNode && activeNode.id === n.id;
    const isConnected = connectedSet.has(n.id);
    const ha = n.highlightAlpha;

    // Show labels when: active/connected, or zoomed in enough with enough highlight
    const shouldShow = isActive || (isConnected && activeNode) || (showAllLabels && ha > 0.5);
    if (!shouldShow) continue;

    const color = KIND_COLORS[n.kind] || '#8b949e';
    const labelY = n.y + n.radius + fontSize * 0.6 + 2;
    const labelAlpha = isActive ? 1.0 : (isConnected ? 0.9 : ha * 0.7);

    // Background pill for readability
    const textWidth = ctx.measureText(n.name).width;
    const pillPadH = 4;
    const pillPadV = 2;
    ctx.fillStyle = `rgba(13,17,23,${labelAlpha * 0.75})`;
    const pillR = (fontSize * 0.35);
    roundRect(ctx,
      n.x - textWidth / 2 - pillPadH,
      labelY - fontSize * 0.45 - pillPadV,
      textWidth + pillPadH * 2,
      fontSize + pillPadV * 2,
      pillR
    );
    ctx.fill();

    // Text
    ctx.fillStyle = isActive
      ? `rgba(255,255,255,${labelAlpha})`
      : hexToRgba(color, labelAlpha);
    ctx.textBaseline = 'middle';
    ctx.fillText(n.name, n.x, labelY);
  }

  // --- 5. Debug info overlay (screen-space) ---
  ctx.restore();
  ctx.save();
  const dpr2 = window.devicePixelRatio;
  ctx.setTransform(dpr2, 0, 0, dpr2, 0, 0);
  {
    let visCount = 0, hidCount = 0, pkgCount = 0;
    for (const n of nodes) {
      if (n.visible) { visCount++; if (n.kind === 'package') pkgCount++; }
      else hidCount++;
    }
    let visEdges = 0;
    for (const e of edges) {
      if (e.source.visible && e.target.visible) visEdges++;
    }
    const lines = [
      `nodes: ${visCount} visible / ${nodes.length} total`,
      `edges: ${visEdges} visible / ${edges.length} total`,
      `packages: ${pkgCount} visible`,
      `alpha: ${graphState.alpha.toFixed(3)}`,
      `zoom: ${transform.k.toFixed(2)}`,
    ];
    const lh = 14;
    const pad = 8;
    const x0 = width - pad;
    const y0 = height - pad - lines.length * lh;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    // Background
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
    ctx.fillStyle = 'rgba(13,17,23,0.7)';
    roundRect(ctx, x0 - maxW - pad, y0 - 4, maxW + pad * 2, lines.length * lh + 8, 4);
    ctx.fill();
    // Text
    ctx.fillStyle = 'rgba(140,150,165,0.9)';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x0, y0 + i * lh);
    }
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// === CANVAS INTERACTION ===
function setupCanvasInteraction(canvas) {
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let dragNode = null;
  let dragStartPos = null; // to detect click vs drag
  let mouseDownTime = 0;

  function screenToWorld(sx, sy) {
    const t = graphState.transform;
    return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
  }

  function hitTest(sx, sy) {
    const { x, y } = screenToWorld(sx, sy);
    let closest = null;
    let closestDist = Infinity;
    for (const n of graphState.nodes) {
      if (!n.visible) continue;
      const dx = n.x - x, dy = n.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitR = n.radius + 6 / graphState.transform.k;
      if (dist < hitR && dist < closestDist) {
        closest = n;
        closestDist = dist;
      }
    }
    return closest;
  }

  // --- Smooth zoom on wheel ---
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const tt = graphState.targetTransform;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const newK = Math.max(0.05, Math.min(12, tt.k * factor));

    // Zoom toward cursor (applied to target, smoothed in loop)
    tt.x = mx - (mx - tt.x) * (newK / tt.k);
    tt.y = my - (my - tt.y) * (newK / tt.k);
    tt.k = newK;
  }, { passive: false });

  // --- Mouse down: drag node or pan ---
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    mouseDownTime = performance.now();

    const node = hitTest(mx, my);
    if (node) {
      dragNode = node;
      dragStartPos = { x: node.x, y: node.y };
      graphState.dragging = node;
      reheat(0.3);
    } else {
      isPanning = true;
      panStart = { x: mx - graphState.targetTransform.x, y: my - graphState.targetTransform.y };
    }
  });

  // --- Mouse move: drag / pan / hover ---
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragNode) {
      const world = screenToWorld(mx, my);
      dragNode.x = world.x;
      dragNode.y = world.y;
      dragNode.vx = 0;
      dragNode.vy = 0;
      return;
    }

    if (isPanning) {
      graphState.targetTransform.x = mx - panStart.x;
      graphState.targetTransform.y = my - panStart.y;
      // For panning, apply immediately (no lerp lag)
      graphState.transform.x = graphState.targetTransform.x;
      graphState.transform.y = graphState.targetTransform.y;
      return;
    }

    // Hover
    const node = hitTest(mx, my);
    if (node !== graphState.hoveredNode) {
      graphState.hoveredNode = node;
      canvas.style.cursor = node ? 'pointer' : 'grab';

      if (node) {
        const kind = KIND_LABELS[node.kind] || '??';
        const kindColor = KIND_COLORS[node.kind] || '#8b949e';
        $graphTooltip.innerHTML =
          `<span class="tooltip-kind" style="color:${kindColor}">${kind}</span>` +
          `<span class="tooltip-name">${escapeHtml(node.name)}</span>` +
          `<span class="tooltip-meta">${escapeHtml(node.package)} · ${escapeHtml(node.file)}:${node.line}</span>`;
        $graphTooltip.classList.remove('hidden');
      } else {
        $graphTooltip.classList.add('hidden');
      }
    }

    // Update tooltip position (even if same node — follow mouse)
    if (graphState.hoveredNode) {
      const contRect = $graphContainer.getBoundingClientRect();
      $graphTooltip.style.left = (e.clientX - contRect.left + 14) + 'px';
      $graphTooltip.style.top = (e.clientY - contRect.top - 8) + 'px';
    }
  });

  // --- Mouse up: end drag/pan, detect click ---
  canvas.addEventListener('mouseup', (e) => {
    const elapsed = performance.now() - mouseDownTime;

    if (dragNode) {
      // Was this a click (short, no movement)?
      const moved = dragStartPos
        ? Math.hypot(dragNode.x - dragStartPos.x, dragNode.y - dragStartPos.y)
        : 999;

      if (elapsed < 250 && moved < 5) {
        // Click — toggle selection
        if (graphState.selectedNode === dragNode) {
          graphState.selectedNode = null;
          dragNode.pinned = false;
        } else {
          graphState.selectedNode = dragNode;
        }
      } else {
        // Drag completed — pin the node
        dragNode.pinned = true;
      }

      dragNode = null;
      dragStartPos = null;
      graphState.dragging = null;
      return;
    }

    if (isPanning) {
      isPanning = false;
      // Click on empty space — deselect
      if (elapsed < 200) {
        graphState.selectedNode = null;
      }
    }
  });

  canvas.addEventListener('mouseleave', () => {
    isPanning = false;
    if (dragNode) {
      dragNode.pinned = true;
      dragNode = null;
      graphState.dragging = null;
    }
    graphState.hoveredNode = null;
    $graphTooltip.classList.add('hidden');
  });

  // --- Double-click: focus entity ---
  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const node = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (node) focusEntity(node.id);
  });
}

function reheat(target) {
  graphState.alpha = Math.max(graphState.alpha, target);
  graphState.alphaTarget = 0;
}

// === ZOOM TOOLBAR ===
function graphZoomIn() {
  if (!graphState) return;
  const tt = graphState.targetTransform;
  const cx = graphState.width / 2;
  const cy = graphState.height / 2;
  const factor = 1.3;
  const newK = Math.min(12, tt.k * factor);
  tt.x = cx - (cx - tt.x) * (newK / tt.k);
  tt.y = cy - (cy - tt.y) * (newK / tt.k);
  tt.k = newK;
}
window.graphZoomIn = graphZoomIn;

function graphZoomOut() {
  if (!graphState) return;
  const tt = graphState.targetTransform;
  const cx = graphState.width / 2;
  const cy = graphState.height / 2;
  const factor = 0.77;
  const newK = Math.max(0.05, tt.k * factor);
  tt.x = cx - (cx - tt.x) * (newK / tt.k);
  tt.y = cy - (cy - tt.y) * (newK / tt.k);
  tt.k = newK;
}
window.graphZoomOut = graphZoomOut;

function graphFitToScreen() {
  if (!graphState) return;
  const { nodes, width, height } = graphState;

  // Compute bounding box of visible nodes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const n of nodes) {
    if (!n.visible) continue;
    minX = Math.min(minX, n.x - n.radius);
    minY = Math.min(minY, n.y - n.radius);
    maxX = Math.max(maxX, n.x + n.radius);
    maxY = Math.max(maxY, n.y + n.radius);
    count++;
  }
  if (count === 0) return;

  const graphW = maxX - minX || 1;
  const graphH = maxY - minY || 1;
  const padding = 60;
  const scaleX = (width - padding * 2) / graphW;
  const scaleY = (height - padding * 2) / graphH;
  const k = Math.min(scaleX, scaleY, 3); // cap at 3x
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  graphState.targetTransform.k = k;
  graphState.targetTransform.x = width / 2 - cx * k;
  graphState.targetTransform.y = height / 2 - cy * k;
}
window.graphFitToScreen = graphFitToScreen;

// === FILTERS ===
function setupFilters(packageInfo, nodes) {
  const kinds = [...new Set(nodes.map(n => n.kind))].sort();
  $kindFilters.innerHTML = kinds.map(k =>
    `<button class="filter-chip active" data-kind="${k}" onclick="toggleKindFilter(this)">` +
    `<span class="chip-dot" style="background:${KIND_COLORS[k] || '#8b949e'}"></span>` +
    `${k}</button>`
  ).join('');

  // Package dropdown checkboxes (all UNCHECKED by default — user opts in)
  $pkgDropdownList.innerHTML = packageInfo.map(p =>
    `<label class="pkg-dropdown-item">` +
    `<input type="checkbox" data-pkg="${escapeHtml(p.name)}" onchange="applyFilters()">` +
    `<span class="pkg-dropdown-path">${escapeHtml(p.full_path)}</span>` +
    `</label>`
  ).join('');
  updatePkgCount();
}

function toggleKindFilter(btn) {
  btn.classList.toggle('active');
  applyFilters();
}
window.toggleKindFilter = toggleKindFilter;

function togglePkgDropdown() {
  $pkgDropdownMenu.classList.toggle('hidden');
}
window.togglePkgDropdown = togglePkgDropdown;

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#package-dropdown')) {
    $pkgDropdownMenu.classList.add('hidden');
  }
});

function updatePkgCount() {
  const checked = $pkgDropdownList.querySelectorAll('input[type="checkbox"]:checked').length;
  const total = $pkgDropdownList.querySelectorAll('input[type="checkbox"]').length;
  $pkgDropdownCount.textContent = `${checked}/${total}`;
}

function applyFilters() {
  if (!graphState) return;

  const activeKinds = new Set();
  $kindFilters.querySelectorAll('.filter-chip.active').forEach(c => activeKinds.add(c.dataset.kind));

  const activePkgs = new Set();
  $pkgDropdownList.querySelectorAll('input[type="checkbox"]:checked').forEach(c => activePkgs.add(c.dataset.pkg));

  graphState.nodes.forEach(n => {
    n.visible = activeKinds.has(n.kind) && activePkgs.has(n.package);
  });

  updatePkgCount();
  reheat(0.5);
}


// === Resize ===
window.addEventListener('resize', () => {
  if (!graphState || currentView !== 'graph') return;
  const rect = $graphContainer.getBoundingClientRect();
  const w = rect.width || window.innerWidth;
  const h = rect.height || (window.innerHeight - 200);
  const dpr = window.devicePixelRatio;
  graphState.canvas.width = w * dpr;
  graphState.canvas.height = h * dpr;
  graphState.canvas.style.width = w + 'px';
  graphState.canvas.style.height = h + 'px';
  graphState.width = w;
  graphState.height = h;
  const ctx = graphState.canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  graphState.ctx = ctx;
});

// === Keyboard shortcuts ===
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl+K to focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    $searchInput.focus();
  }
  // Escape in focus view returns to browse
  if (e.key === 'Escape' && !$focusContainer.classList.contains('hidden')) {
    showBrowse();
  }
});

// === Init ===
$openRepoBtn.addEventListener('click', openRepo);
