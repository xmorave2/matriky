'use strict';

const PAGE_SIZE = 20;

// State
let allRecords = [];
let placeIndex = new Map();   // normalized-string -> Set<recordIndex>
let allPlaces = [];           // sorted list for autocomplete
let fuse = null;
let currentResults = [];
let currentPage = 1;
let searchDebounceTimer = null;

// DOM refs
const searchInput    = document.getElementById('search-input');
const datalist       = document.getElementById('place-suggestions');
const loadingEl      = document.getElementById('loading');
const emptyStateEl   = document.getElementById('empty-state');
const resultsEl      = document.getElementById('results');
const resultCountEl  = document.getElementById('result-count');
const paginationEl   = document.getElementById('pagination');
const prevBtn        = document.getElementById('prev-btn');
const nextBtn        = document.getElementById('next-btn');
const pageInfoEl     = document.getElementById('page-info');
const resetBtn       = document.getElementById('reset-btn');
const resetLink      = document.getElementById('reset-link');

// Czech collator for sorting
const collator = new Intl.Collator('cs', { sensitivity: 'base' });

// Normalize string for search: lowercase + strip diacritics
function normalize(str) {
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Build inverted place index and autocomplete list
function buildIndexes() {
  placeIndex.clear();
  const placeSet = new Set();

  allRecords.forEach((record, i) => {
    (record.matricni_misto_zkracene ?? []).forEach(place => {
      const key = normalize(place);
      if (!placeIndex.has(key)) placeIndex.set(key, new Set());
      placeIndex.get(key).add(i);
      placeSet.add(place);
    });
  });

  allPlaces = [...placeSet].sort((a, b) => collator.compare(a, b));

  // Fuse.js for fuzzy autocomplete — loads after defer, so check
  if (typeof Fuse !== 'undefined') {
    fuse = new Fuse(allPlaces, { threshold: 0.35, distance: 80 });
  }
}

// Get checked values for a checkbox group
function getChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)]
    .map(el => el.value);
}

// Main search function
function runSearch() {
  const rawQuery = searchInput.value.trim();
  const query = normalize(rawQuery);
  const selectedTyp    = getChecked('typ');
  const selectedJazyk  = getChecked('jazyk');
  const selectedVyzani = getChecked('vyzani');

  let candidates;

  if (query.length === 0) {
    candidates = allRecords;
  } else {
    const keys = [...placeIndex.keys()];
    const matchingKeys = keys.filter(k => k.includes(query));
    if (matchingKeys.length === 0) {
      candidates = [];
    } else {
      const indexSet = new Set();
      matchingKeys.forEach(k => placeIndex.get(k).forEach(i => indexSet.add(i)));
      candidates = [...indexSet].map(i => allRecords[i]);
    }
  }

  if (selectedTyp.length) {
    candidates = candidates.filter(r =>
      selectedTyp.some(t => (r.typ ?? []).includes(t))
    );
  }
  if (selectedJazyk.length) {
    candidates = candidates.filter(r =>
      selectedJazyk.some(l => (r.jazyk ?? []).includes(l))
    );
  }
  if (selectedVyzani.length) {
    candidates = candidates.filter(r =>
      selectedVyzani.includes(r.nabozensky_puvod)
    );
  }

  currentResults = candidates;
  currentPage = 1;
  renderResults();
  updateHash();
}

// Debounced wrapper for search input
function onSearchInput() {
  clearTimeout(searchDebounceTimer);
  updateAutocomplete();
  searchDebounceTimer = setTimeout(runSearch, 200);
}

// Update datalist for autocomplete
function updateAutocomplete() {
  const query = normalize(searchInput.value.trim());
  if (query.length < 2) {
    datalist.innerHTML = '';
    return;
  }

  let matches;
  if (fuse) {
    matches = fuse.search(searchInput.value.trim(), { limit: 10 }).map(r => r.item);
  } else {
    // Fallback: simple substring
    matches = allPlaces.filter(p => normalize(p).includes(query)).slice(0, 10);
  }

  datalist.innerHTML = matches.map(p => `<option value="${escHtml(p)}"></option>`).join('');
}

// Render results for current page
function renderResults() {
  const total = currentResults.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Update count
  const formatted = total.toLocaleString('cs');
  resultCountEl.innerHTML = `Nalezeno: <strong>${formatted}</strong> ${pluralRecords(total)}`;

  // Show/hide empty state
  if (total === 0) {
    resultsEl.style.display = 'none';
    paginationEl.style.display = 'none';
    emptyStateEl.style.display = 'block';
    return;
  }
  emptyStateEl.style.display = 'none';
  resultsEl.style.display = '';
  paginationEl.style.display = '';

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRecords = currentResults.slice(start, start + PAGE_SIZE);

  const fragment = document.createDocumentFragment();
  pageRecords.forEach(record => fragment.appendChild(renderCard(record)));
  resultsEl.innerHTML = '';
  resultsEl.appendChild(fragment);

  // Pagination controls
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  pageInfoEl.textContent = `Strana ${currentPage} / ${totalPages}`;

  // Scroll to top of results on page change
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Build a record card element
function renderCard(record) {
  const article = document.createElement('article');
  article.className = 'card';
  article.setAttribute('role', 'listitem');

  // Header: title + signature/date
  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = record.nazev ?? '(bez názvu)';

  const sig = document.createElement('div');
  sig.className = 'card-sig';
  sig.innerHTML = `<strong>${escHtml(record.signatura ?? '')}</strong>${escHtml(record.datace ?? '')}`;

  header.appendChild(title);
  header.appendChild(sig);
  article.appendChild(header);

  // Places
  const places = record.matricni_misto_zkracene ?? [];
  if (places.length > 0) {
    const placesEl = document.createElement('div');
    placesEl.className = 'card-places';
    places.forEach(p => {
      const tag = document.createElement('span');
      tag.className = 'place-tag';
      tag.textContent = p;
      placesEl.appendChild(tag);
    });
    article.appendChild(placesEl);
  }

  // Type chips + language chips
  const chips = document.createElement('div');
  chips.className = 'card-chips';
  (record.typ ?? []).forEach(t => {
    const chip = document.createElement('span');
    chip.className = `chip ${typChipClass(t)}`;
    chip.textContent = t;
    chips.appendChild(chip);
  });
  (record.jazyk ?? []).forEach(j => {
    const chip = document.createElement('span');
    chip.className = 'chip chip-jazyk';
    chip.textContent = j;
    chips.appendChild(chip);
  });
  article.appendChild(chips);

  // Meta: folio count, physical state
  const metaParts = [];
  if (record.pocet_folii) metaParts.push(escHtml(record.pocet_folii));
  if (record.rozmery) metaParts.push(escHtml(record.rozmery));
  if (record.nabozensky_puvod) metaParts.push(escHtml(record.nabozensky_puvod));
  if (metaParts.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.innerHTML = metaParts.join(' &middot; ');
    article.appendChild(meta);
  }

  // Thematic description (sparse)
  if (record.tematicky_popis) {
    const desc = document.createElement('div');
    desc.className = 'card-desc';
    desc.textContent = record.tematicky_popis;
    article.appendChild(desc);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (record.odkaz_prohlizet) {
    const a = document.createElement('a');
    a.href = record.odkaz_prohlizet;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'btn btn-primary';
    a.textContent = 'Prohlížet online';
    actions.appendChild(a);
  } else {
    const span = document.createElement('span');
    span.className = 'btn btn-disabled';
    span.title = 'Digitalizace není k dispozici';
    span.setAttribute('aria-disabled', 'true');
    span.textContent = 'Prohlížet online';
    actions.appendChild(span);
  }

  if (record.odkaz_stahnout) {
    const a = document.createElement('a');
    a.href = record.odkaz_stahnout;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'btn btn-secondary';
    a.textContent = 'Stáhnout ZIP';
    actions.appendChild(a);
  } else {
    const span = document.createElement('span');
    span.className = 'btn btn-disabled';
    span.title = 'Digitalizace není k dispozici';
    span.setAttribute('aria-disabled', 'true');
    span.textContent = 'Stáhnout ZIP';
    actions.appendChild(span);
  }

  article.appendChild(actions);
  return article;
}

// Map record type to chip CSS class
function typChipClass(typ) {
  if (typ === 'matrika NAROZENÝCH') return 'chip-narozeni';
  if (typ === 'matrika ZEMŘELÝCH')  return 'chip-zemreli';
  if (typ === 'matrika ODDANÝCH')   return 'chip-oddani';
  if (typ === 'index NAROZENÝCH')   return 'chip-index-n';
  if (typ === 'index ZEMŘELÝCH')    return 'chip-index-z';
  if (typ === 'index ODDANÝCH')     return 'chip-index-o';
  return 'chip-zemreli';
}

// Czech plural for "záznam/záznamy/záznamů"
function pluralRecords(n) {
  if (n === 1) return 'záznam';
  if (n >= 2 && n <= 4) return 'záznamy';
  return 'záznamů';
}

// Simple HTML escape
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Reset all filters and search
function resetAll() {
  searchInput.value = '';
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  datalist.innerHTML = '';
  runSearch();
}

// URL hash state: #q=...&typ=...&jazyk=...&vyzani=...
function updateHash() {
  const params = new URLSearchParams();
  const q = searchInput.value.trim();
  if (q) params.set('q', q);
  const typ = getChecked('typ');
  if (typ.length) params.set('typ', typ.join(','));
  const jazyk = getChecked('jazyk');
  if (jazyk.length) params.set('jazyk', jazyk.join(','));
  const vyzani = getChecked('vyzani');
  if (vyzani.length) params.set('vyzani', vyzani.join(','));

  const hash = params.toString();
  history.replaceState(null, '', hash ? '#' + hash : location.pathname);
}

function restoreFromHash() {
  const hash = location.hash.slice(1);
  if (!hash) return;
  const params = new URLSearchParams(hash);

  if (params.has('q')) searchInput.value = params.get('q');
  if (params.has('typ')) {
    params.get('typ').split(',').forEach(v => {
      const cb = document.querySelector(`input[name="typ"][value="${CSS.escape(v)}"]`);
      if (cb) cb.checked = true;
    });
  }
  if (params.has('jazyk')) {
    params.get('jazyk').split(',').forEach(v => {
      const cb = document.querySelector(`input[name="jazyk"][value="${CSS.escape(v)}"]`);
      if (cb) cb.checked = true;
    });
  }
  if (params.has('vyzani')) {
    params.get('vyzani').split(',').forEach(v => {
      const cb = document.querySelector(`input[name="vyzani"][value="${CSS.escape(v)}"]`);
      if (cb) cb.checked = true;
    });
  }
}

// Wire up Fuse after it loads (it's deferred, may not be ready at init)
function ensureFuse() {
  if (!fuse && typeof Fuse !== 'undefined' && allPlaces.length > 0) {
    fuse = new Fuse(allPlaces, { threshold: 0.35, distance: 80 });
  }
}

// Initialise
async function init() {
  loadingEl.style.display = 'block';
  resultsEl.style.display = 'none';
  paginationEl.style.display = 'none';

  try {
    const response = await fetch('data.json');
    allRecords = await response.json();
  } catch (err) {
    loadingEl.innerHTML = `<p style="color:#dc2626">Chyba při načítání dat: ${escHtml(String(err))}</p>`;
    return;
  }

  buildIndexes();
  loadingEl.style.display = 'none';

  // Restore state from URL hash, then run search
  restoreFromHash();

  // Event listeners
  searchInput.addEventListener('input', onSearchInput);
  searchInput.addEventListener('change', () => { ensureFuse(); runSearch(); });
  document.querySelectorAll('input[type="checkbox"]').forEach(cb =>
    cb.addEventListener('change', runSearch)
  );
  resetBtn.addEventListener('click', resetAll);
  resetLink.addEventListener('click', resetAll);
  prevBtn.addEventListener('click', () => { currentPage--; renderResults(); });
  nextBtn.addEventListener('click', () => { currentPage++; renderResults(); });
  window.addEventListener('hashchange', () => { restoreFromHash(); runSearch(); });

  runSearch();
}

document.addEventListener('DOMContentLoaded', init);
