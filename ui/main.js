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
const $graphLegend = document.getElementById('graph-legend');
const $graphFilters = document.getElementById('graph-filters');
const $kindFilters = document.getElementById('kind-filters');
const $packageFilter = document.getElementById('package-filter');

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
  if (graphState) graphState.running = false;
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

// === Kind color map (matches CSS badge colors) ===
const KIND_COLORS = {
  function:  '#58a6ff',
  method:    '#bc8cff',
  struct:    '#3fb950',
  interface: '#d29922',
  type:      '#d29922',
  const:     '#f85149',
  var:       '#f778ba',
  import:    '#76e3ea',
  package:   '#76e3ea',
  class:     '#3fb950',
  enum:      '#d29922',
  trait:     '#d29922',
  module:    '#76e3ea',
};

const KIND_LABELS = {
  function: 'fn', method: 'me', struct: 'st', interface: 'if',
  type: 'ty', const: 'co', var: 'va', import: 'im',
  package: 'pk', class: 'cl', enum: 'en', trait: 'tr', module: 'mo',
};

// === Force-Directed Graph ===
async function loadGraphView() {
  if (graphState && graphState.graphData) {
    // Already loaded, just restart rendering
    graphState.running = true;
    renderGraph();
    return;
  }

  try {
    const data = await invoke('get_graph_data');
    initGraph(data);
  } catch (err) {
    console.error('Graph load error:', err);
  }
}

function initGraph(data) {
  const canvas = $graphCanvas;
  const container = $graphContainer;
  const rect = container.getBoundingClientRect();
  const width = rect.width || window.innerWidth;
  const height = rect.height || (window.innerHeight - 200);
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  // Build node map for quick lookup
  const nodeMap = new Map();
  const nodes = data.nodes.map((n, i) => {
    const node = {
      ...n,
      x: width / 2 + (Math.random() - 0.5) * width * 0.6,
      y: height / 2 + (Math.random() - 0.5) * height * 0.6,
      vx: 0,
      vy: 0,
      radius: 6,
      visible: true,
    };
    nodeMap.set(n.id, node);
    return node;
  });

  const edges = data.edges.map(e => ({
    source: nodeMap.get(e.source),
    target: nodeMap.get(e.target),
    kind: e.kind,
  })).filter(e => e.source && e.target);

  // Build adjacency for degree calculation
  const degree = new Map();
  edges.forEach(e => {
    degree.set(e.source.id, (degree.get(e.source.id) || 0) + 1);
    degree.set(e.target.id, (degree.get(e.target.id) || 0) + 1);
  });
  // Scale node radius by degree
  nodes.forEach(n => {
    const d = degree.get(n.id) || 0;
    n.radius = Math.max(4, Math.min(16, 4 + Math.sqrt(d) * 2));
  });

  // Package clustering: assign cluster centers
  const pkgSet = [...new Set(nodes.map(n => n.package))];
  const pkgCenters = new Map();
  pkgSet.forEach((pkg, i) => {
    const angle = (2 * Math.PI * i) / pkgSet.length;
    const clusterRadius = Math.min(width, height) * 0.3;
    pkgCenters.set(pkg, {
      x: width / 2 + Math.cos(angle) * clusterRadius,
      y: height / 2 + Math.sin(angle) * clusterRadius,
    });
  });

  // Set initial positions near cluster centers
  nodes.forEach(n => {
    const center = pkgCenters.get(n.package);
    if (center) {
      n.x = center.x + (Math.random() - 0.5) * 80;
      n.y = center.y + (Math.random() - 0.5) * 80;
    }
  });

  // Setup filter chips
  setupFilters(data.packages, nodes);

  // Setup legend
  renderLegend(nodes);

  graphState = {
    nodes,
    edges,
    nodeMap,
    ctx,
    canvas,
    width,
    height,
    pkgCenters,
    graphData: data,
    running: true,
    // Interaction state
    transform: { x: 0, y: 0, k: 1 },
    dragging: null,
    hoveredNode: null,
    alpha: 1.0, // simulation temperature
    alphaDecay: 0.0228,
    alphaMin: 0.001,
  };

  setupCanvasInteraction(canvas);
  runSimulation();
}

function runSimulation() {
  if (!graphState || !graphState.running) return;

  const { nodes, edges, pkgCenters, width, height } = graphState;

  if (graphState.alpha > graphState.alphaMin) {
    // Apply forces
    applyForces(nodes, edges, pkgCenters, width, height, graphState.alpha);
    graphState.alpha *= (1 - graphState.alphaDecay);
  }

  renderGraph();
  requestAnimationFrame(runSimulation);
}

function applyForces(nodes, edges, pkgCenters, width, height, alpha) {
  const visibleNodes = nodes.filter(n => n.visible);
  const visibleSet = new Set(visibleNodes.map(n => n.id));

  // Repulsion (Barnes-Hut approximation for performance)
  const repulsionStrength = -120;
  for (let i = 0; i < visibleNodes.length; i++) {
    for (let j = i + 1; j < visibleNodes.length; j++) {
      const a = visibleNodes[i];
      const b = visibleNodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist > 300) continue; // optimization: skip far nodes
      const force = repulsionStrength * alpha / (dist * dist);
      const fx = dx / dist * force;
      const fy = dy / dist * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Edge attraction
  const linkStrength = 0.05;
  const linkDistance = 60;
  edges.forEach(e => {
    if (!visibleSet.has(e.source.id) || !visibleSet.has(e.target.id)) return;
    let dx = e.target.x - e.source.x;
    let dy = e.target.y - e.source.y;
    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - linkDistance) * linkStrength * alpha;
    const fx = dx / dist * force;
    const fy = dy / dist * force;
    e.source.vx += fx;
    e.source.vy += fy;
    e.target.vx -= fx;
    e.target.vy -= fy;
  });

  // Package clustering force
  const clusterStrength = 0.15;
  visibleNodes.forEach(n => {
    const center = pkgCenters.get(n.package);
    if (center) {
      n.vx += (center.x - n.x) * clusterStrength * alpha;
      n.vy += (center.y - n.y) * clusterStrength * alpha;
    }
  });

  // Center gravity
  const gravityStrength = 0.01;
  visibleNodes.forEach(n => {
    n.vx += (width / 2 - n.x) * gravityStrength * alpha;
    n.vy += (height / 2 - n.y) * gravityStrength * alpha;
  });

  // Velocity damping and position update
  const damping = 0.6;
  visibleNodes.forEach(n => {
    n.vx *= damping;
    n.vy *= damping;
    n.x += n.vx;
    n.y += n.vy;
    // Keep within bounds (soft boundary)
    const margin = 20;
    if (n.x < margin) n.x = margin;
    if (n.x > width - margin) n.x = width - margin;
    if (n.y < margin) n.y = margin;
    if (n.y > height - margin) n.y = height - margin;
  });
}

function renderGraph() {
  if (!graphState) return;
  const { ctx, canvas, nodes, edges, width, height, transform, hoveredNode } = graphState;

  ctx.save();
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Apply zoom/pan transform
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const visibleSet = new Set(nodes.filter(n => n.visible).map(n => n.id));

  // Draw edges
  ctx.lineWidth = 0.5 / transform.k;
  ctx.strokeStyle = 'rgba(48, 54, 61, 0.6)';
  ctx.beginPath();
  edges.forEach(e => {
    if (!visibleSet.has(e.source.id) || !visibleSet.has(e.target.id)) return;
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
  });
  ctx.stroke();

  // Draw edges for hovered node highlighted
  if (hoveredNode && hoveredNode.visible) {
    ctx.lineWidth = 1.5 / transform.k;
    ctx.strokeStyle = 'rgba(88, 166, 255, 0.5)';
    ctx.beginPath();
    edges.forEach(e => {
      if (!visibleSet.has(e.source.id) || !visibleSet.has(e.target.id)) return;
      if (e.source.id === hoveredNode.id || e.target.id === hoveredNode.id) {
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);
      }
    });
    ctx.stroke();
  }

  // Draw nodes
  nodes.forEach(n => {
    if (!n.visible) return;
    const color = KIND_COLORS[n.kind] || '#8b949e';
    const isHovered = hoveredNode && hoveredNode.id === n.id;
    const isConnected = hoveredNode && edges.some(
      e => (e.source.id === hoveredNode.id && e.target.id === n.id) ||
           (e.target.id === hoveredNode.id && e.source.id === n.id)
    );
    const dimmed = hoveredNode && !isHovered && !isConnected;

    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius / transform.k * (isHovered ? 1.3 : 1), 0, Math.PI * 2);

    if (dimmed) {
      ctx.fillStyle = hexToRgba(color, 0.15);
    } else {
      ctx.fillStyle = hexToRgba(color, 0.8);
    }
    ctx.fill();

    if (isHovered) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / transform.k;
      ctx.stroke();
    }
  });

  // Draw labels for zoomed-in view or hovered
  if (transform.k > 1.2 || hoveredNode) {
    ctx.font = `${Math.max(9, 11 / transform.k)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    nodes.forEach(n => {
      if (!n.visible) return;
      const isHovered = hoveredNode && hoveredNode.id === n.id;
      const isConnected = hoveredNode && edges.some(
        e => (e.source.id === hoveredNode.id && e.target.id === n.id) ||
             (e.target.id === hoveredNode.id && e.source.id === n.id)
      );
      const dimmed = hoveredNode && !isHovered && !isConnected;
      if (dimmed) return;
      if (!isHovered && !isConnected && transform.k <= 1.2) return;

      const color = KIND_COLORS[n.kind] || '#8b949e';
      ctx.fillStyle = isHovered ? '#ffffff' : color;
      ctx.fillText(n.name, n.x, n.y + n.radius / transform.k + 3 / transform.k);
    });
  }

  ctx.restore();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// === Canvas Interaction (zoom, pan, drag, hover, click) ===
function setupCanvasInteraction(canvas) {
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let dragNode = null;

  function screenToWorld(sx, sy) {
    const t = graphState.transform;
    return {
      x: (sx - t.x) / t.k,
      y: (sy - t.y) / t.k,
    };
  }

  function hitTest(sx, sy) {
    const { x, y } = screenToWorld(sx, sy);
    const { nodes, transform } = graphState;
    let closest = null;
    let closestDist = Infinity;
    for (const n of nodes) {
      if (!n.visible) continue;
      const dx = n.x - x;
      const dy = n.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = n.radius / transform.k + 4 / transform.k;
      if (dist < hitRadius && dist < closestDist) {
        closest = n;
        closestDist = dist;
      }
    }
    return closest;
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const t = graphState.transform;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newK = Math.max(0.1, Math.min(10, t.k * zoomFactor));

    // Zoom toward mouse position
    t.x = mx - (mx - t.x) * (newK / t.k);
    t.y = my - (my - t.y) * (newK / t.k);
    t.k = newK;

    renderGraph();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const node = hitTest(mx, my);
    if (node) {
      dragNode = node;
      graphState.dragging = node;
      // Reheat simulation slightly on drag
      graphState.alpha = Math.max(graphState.alpha, 0.1);
      if (!graphState.running) {
        graphState.running = true;
        runSimulation();
      }
    } else {
      isPanning = true;
      panStart = { x: mx - graphState.transform.x, y: my - graphState.transform.y };
    }
  });

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
      renderGraph();
      return;
    }

    if (isPanning) {
      graphState.transform.x = mx - panStart.x;
      graphState.transform.y = my - panStart.y;
      renderGraph();
      return;
    }

    // Hover detection
    const node = hitTest(mx, my);
    if (node !== graphState.hoveredNode) {
      graphState.hoveredNode = node;
      canvas.style.cursor = node ? 'pointer' : 'grab';

      if (node) {
        $graphTooltip.innerHTML = `
          <span class="tooltip-kind" style="color:${KIND_COLORS[node.kind] || '#8b949e'}">${KIND_LABELS[node.kind] || '??'}</span>
          <span class="tooltip-name">${escapeHtml(node.name)}</span>
          <span class="tooltip-meta">${escapeHtml(node.package)} &middot; ${escapeHtml(node.file)}:${node.line}</span>
        `;
        $graphTooltip.style.left = (e.clientX - $graphContainer.getBoundingClientRect().left + 12) + 'px';
        $graphTooltip.style.top = (e.clientY - $graphContainer.getBoundingClientRect().top - 10) + 'px';
        $graphTooltip.classList.remove('hidden');
      } else {
        $graphTooltip.classList.add('hidden');
      }

      renderGraph();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (dragNode) {
      dragNode = null;
      graphState.dragging = null;
      return;
    }
    isPanning = false;
  });

  canvas.addEventListener('mouseleave', () => {
    isPanning = false;
    dragNode = null;
    graphState.dragging = null;
    graphState.hoveredNode = null;
    $graphTooltip.classList.add('hidden');
    renderGraph();
  });

  // Double-click to focus entity
  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = hitTest(mx, my);
    if (node) {
      focusEntity(node.id);
    }
  });
}

// === Graph Filters ===
function setupFilters(packages, nodes) {
  // Kind filter chips
  const kinds = [...new Set(nodes.map(n => n.kind))].sort();
  $kindFilters.innerHTML = kinds.map(k => `
    <button class="filter-chip active" data-kind="${k}" onclick="toggleKindFilter(this, '${k}')">
      <span class="chip-dot" style="background:${KIND_COLORS[k] || '#8b949e'}"></span>
      ${KIND_LABELS[k] || k}
    </button>
  `).join('');

  // Package dropdown
  $packageFilter.innerHTML = '<option value="">All packages</option>' +
    packages.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');

  $packageFilter.onchange = () => applyFilters();
}

function toggleKindFilter(btn, kind) {
  btn.classList.toggle('active');
  applyFilters();
}
window.toggleKindFilter = toggleKindFilter;

function applyFilters() {
  if (!graphState) return;

  // Get active kind filters
  const activeKinds = new Set();
  $kindFilters.querySelectorAll('.filter-chip.active').forEach(chip => {
    activeKinds.add(chip.dataset.kind);
  });

  const selectedPkg = $packageFilter.value;

  graphState.nodes.forEach(n => {
    n.visible = activeKinds.has(n.kind) && (!selectedPkg || n.package === selectedPkg);
  });

  // Reheat simulation
  graphState.alpha = 0.3;
  if (!graphState.running) {
    graphState.running = true;
    runSimulation();
  }

  renderGraph();
}

function renderLegend(nodes) {
  const kinds = [...new Set(nodes.map(n => n.kind))].sort();
  $graphLegend.innerHTML = kinds.map(k => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${KIND_COLORS[k] || '#8b949e'}"></span>
      ${k}
    </span>
  `).join('');
}

// === Handle resize for graph ===
window.addEventListener('resize', () => {
  if (graphState && currentView === 'graph') {
    const rect = $graphContainer.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || (window.innerHeight - 200);
    graphState.canvas.width = width * window.devicePixelRatio;
    graphState.canvas.height = height * window.devicePixelRatio;
    graphState.canvas.style.width = width + 'px';
    graphState.canvas.style.height = height + 'px';
    graphState.width = width;
    graphState.height = height;
    const ctx = graphState.canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    graphState.ctx = ctx;
    renderGraph();
  }
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
