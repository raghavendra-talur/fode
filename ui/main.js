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

// === State ===
let repoInfo = null;
let searchTimeout = null;

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
  const { center, related } = focus;

  // Separate related by direction
  const incoming = related.filter(r => r.direction === 'incoming');
  const outgoing = related.filter(r => r.direction === 'outgoing');
  const siblings = related.filter(r => r.direction === 'sibling');

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

  // Incoming
  $relatedIncoming.innerHTML = '';
  if (incoming.length > 0) {
    $relatedIncoming.innerHTML = `<div class="related-section-label">referenced by</div>` +
      incoming.map(r => relatedCardHtml(r)).join('');
  }

  // Outgoing + siblings
  $relatedOutgoing.innerHTML = '';
  if (outgoing.length > 0) {
    $relatedOutgoing.innerHTML = `<div class="related-section-label">references</div>` +
      outgoing.map(r => relatedCardHtml(r)).join('');
  }
  if (siblings.length > 0) {
    $relatedOutgoing.innerHTML += `<div class="related-section-label" style="margin-top:0.5rem">same package</div>` +
      siblings.map(r => relatedCardHtml(r)).join('');
  }
}

function relatedCardHtml(r) {
  return `
    <div class="related-card" onclick="focusEntity('${escapeHtml(r.entity.id)}')">
      <div class="related-card-header">
        ${kindBadge(r.entity.kind)}
        <span class="related-card-name">${escapeHtml(r.entity.name)}</span>
      </div>
      <div class="related-card-relation">${escapeHtml(r.relation)}</div>
      <div class="related-card-sig">${escapeHtml(r.entity.signature)}</div>
    </div>
  `;
}

function showBrowse() {
  $focusContainer.classList.add('hidden');
  $browseContainer.style.display = '';
}
window.showBrowse = showBrowse;

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
