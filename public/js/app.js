// ═══════════════════════════════════════════════
// COMPRECIO — App simplificada
// ═══════════════════════════════════════════════
const API = '/api';
let token = localStorage.getItem('cp_token');
let currentUser = JSON.parse(localStorage.getItem('cp_user') || 'null');
let map, mapReady = false;
let userLat = -34.6037, userLng = -58.3816;
let bizMarkers = [];

// Wizard state
let selProductId = null, selProductName = '', selBizId = null, selBizName = '';
let isPromo = false, noStock = false;
let searchTimer;
let rankZoneActive = false;  // filtro de zona en ranking
let wizardBizPending = null; // negocio en espera de ubicación desde wizard

// ── INIT ────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  updateChip();
  loadCatPills();
  loadHomeFeed();
  loadLevels();
  tryGeo();
  maybeShowOnboarding();
});

// ── ONBOARDING ───────────────────────────────────
function maybeShowOnboarding() {
  if (!localStorage.getItem('cp_onboarding_done')) {
    const el = document.getElementById('onboarding-bg');
    el.style.display = 'flex';
  }
}
function closeOnboarding() {
  document.getElementById('onboarding-bg').style.display = 'none';
  localStorage.setItem('cp_onboarding_done', '1');
}

// ── GEO ─────────────────────────────────────────
function tryGeo() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    if (mapReady && map) map.setView([userLat, userLng], 15);
  });
}

// ── API HELPER ──────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

// ── TOAST ────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('my-toast');
  el.textContent = (type === 'ok' ? '✅ ' : type === 'err' ? '❌ ' : 'ℹ️ ') + msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── TABS ─────────────────────────────────────────
function goTab(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  const nb = document.getElementById('nav-' + name);
  if (nb) nb.classList.add('active');

  if (name === 'mapa') initMap();
  if (name === 'ranking') { if (rankTab === 'precios') loadRanking(); else loadCommunityRanking(); }
  if (name === 'perfil') loadProfile();
  if (name === 'report') {
    if (!token) { openAuth(); return; }
    resetReport();
  }
  if (name === 'admin') {
    if (!currentUser || currentUser.role !== 'admin') { goTab('home'); toast('Acceso denegado', 'err'); return; }
    adminTab('stats');
  }
  window.scrollTo(0, 0);
}

// ── GLOBAL SEARCH ────────────────────────────────
let gsTimer;
async function onGlobalSearch(q) {
  const box = document.getElementById('global-sugg');
  clearTimeout(gsTimer);
  if (q.length < 2) { box.style.display = 'none'; return; }
  gsTimer = setTimeout(async () => {
    try {
      const products = await api('GET', `/products?search=${encodeURIComponent(q)}`);
      if (!products.length) { box.style.display = 'none'; return; }
      box.innerHTML = products.slice(0, 6).map(p => `
        <div class="sugg-item" onclick="filterHomeByProduct(${p.id},'${esc(p.name)}')">
          <span class="sugg-icon">🔍</span>
          <div><strong>${p.name}</strong> <small style="color:var(--muted)">${p.unit}</small></div>
        </div>`).join('');
      box.style.display = 'block';
    } catch {}
  }, 250);
}

function filterHomeByProduct(id, name) {
  document.getElementById('global-sugg').style.display = 'none';
  document.getElementById('global-search').value = name;
  goTab('home');
  loadHomeFeed(id);
}

// ── HOME ─────────────────────────────────────────
async function loadCatPills() {
  try {
    const cats = await api('GET', '/products/categories');
    const row = document.getElementById('cat-pills');
    row.innerHTML = `<div class="pill active" onclick="filterCat(null,this)">Todo</div>` +
      cats.map(c => `<div class="pill" onclick="filterCat('${esc(c)}',this)">${c}</div>`).join('');
  } catch {}
}

async function filterCat(cat, el) {
  document.querySelectorAll('#cat-pills .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('global-search').value = '';
  document.getElementById('global-sugg').style.display = 'none';
  loadHomeFeed(null, cat);
}

async function loadHomeFeed(productId = null, category = null) {
  const feed = document.getElementById('home-feed');
  feed.innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';
  try {
    let url = '/prices?';
    if (productId) url += `product_id=${productId}&`;
    const prices = await api('GET', url);
    let filtered = prices;
    if (category) filtered = prices.filter(p => p.category === category);
    if (!filtered.length) {
      feed.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><h3>Sin precios aún</h3><p>Sé el primero en reportar un precio en tu zona</p></div>`;
      return;
    }
    feed.innerHTML = filtered.slice(0, 40).map(p => renderCard(p)).join('');
  } catch {
    feed.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><h3>Error cargando precios</h3></div>`;
  }
}

// ── PRICE CARD ───────────────────────────────────
function renderCard(p) {
  const freshness = getFreshness(p.updated_at);
  const badgeHtml = p.is_promotion ? `<span class="badge-p">🏷️ Oferta</span>` : '';
  const freshBadge = freshness === 'fresh' ? `<span class="badge-f">Confirmado hoy</span>` :
                     freshness === 'recent' ? `<span class="badge-r">Hace poco</span>` :
                     `<span class="badge-o">Sin confirmar</span>`;
  const confirmTxt = p.confirmed_count > 0 ? `<span class="badge-c">✅ ${p.confirmed_count} persona${p.confirmed_count > 1 ? 's' : ''} lo vio así</span>` : '';
  const myR = p.my_reaction || '';
  return `
    <div class="price-card ${p.status === 'out_of_stock' ? 'nostock' : freshness === 'recent' ? 'stale' : ''}" onclick="openDetail(${p.id})">
      <div class="card-top">
        <div>
          <div class="card-product">${p.product_name} <span class="card-unit">${p.unit}</span></div>
          <div class="card-store"><i class="fa fa-store" style="font-size:.75rem;margin-right:4px"></i>${p.business_name}${p.verified ? ' <span style="color:var(--green);font-size:.7rem">✅</span>' : ''}</div>
          ${p.address ? `<div class="card-store" style="font-size:.78rem;color:#999"><i class="fa fa-map-pin" style="font-size:.75rem;margin-right:3px"></i>${p.address}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div class="card-price ${p.is_promotion ? 'promo' : ''}">$${fmt(p.price)}</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:2px">por ${p.unit}</div>
        </div>
      </div>
      <div class="card-badges">${freshBadge}${badgeHtml}${confirmTxt}
        ${p.reporter_badge && p.reporter_points >= 100 ? `<span style="background:#f3e8ff;color:#6b21a8;border-radius:10px;padding:3px 9px;font-size:.72rem;font-weight:600">${badgeIcon(p.reporter_badge)} ${p.reporter_badge}</span>` : ''}
      </div>
      <div class="react-row" onclick="event.stopPropagation()">
        <button class="react-btn ${myR === 'confirmed' ? 'ok' : ''}" onclick="react(${p.id},'confirmed',this)">
          ✅ Sí, es correcto
        </button>
        <button class="react-btn ${myR === 'disputed' ? 'bad' : ''}" onclick="react(${p.id},'disputed',this)">
          ❌ El precio cambió
        </button>
      </div>
    </div>`;
}

// Badge icon por nivel
function badgeIcon(badge) {
  if (!badge) return '';
  if (badge === 'Maestro de Precios') return '👑';
  if (badge === 'Cazador Experto') return '⭐';
  if (badge === 'Cazador de Precios') return '🎯';
  if (badge === 'Reportero Activo') return '📢';
  if (badge === 'Colaborador') return '🤝';
  return '🌱';
}

function getFreshness(dateStr) {
  if (!dateStr) return 'old';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 86400000) return 'fresh';
  if (diff < 259200000) return 'recent';
  return 'old';
}

function fmt(n) {
  return parseFloat(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function esc(s) { return (s || '').replace(/'/g, "\\'"); }

// ── REACTIONS ────────────────────────────────────
async function react(priceId, type, btn) {
  if (!token) { openAuth(); return; }
  try {
    await api('POST', `/prices/${priceId}/react`, { reaction_type: type });
    const row = btn.parentElement;
    row.querySelectorAll('.react-btn').forEach(b => { b.classList.remove('ok', 'bad'); });
    if (type === 'confirmed') btn.classList.add('ok');
    else btn.classList.add('bad');
    toast(type === 'confirmed' ? '¡Gracias por confirmar!' : 'Marcado como cambiado', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

// ── DETAIL SHEET ─────────────────────────────────
async function openDetail(priceId) {
  const bg = document.getElementById('detail-bg');
  const body = document.getElementById('det-body');
  bg.classList.add('open');
  body.innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';

  try {
    const prices = await api('GET', `/prices?`);
    const p = prices.find(x => x.id === priceId);
    if (!p) return;

    document.getElementById('det-title').textContent = `${p.product_name} (${p.unit})`;
    document.getElementById('det-sub').textContent = `en ${p.business_name}`;

    const history = await api('GET', `/prices/${priceId}/history`);
    const histHtml = history.length ? `
      <div style="margin-top:16px">
        <div style="font-weight:700;margin-bottom:8px">📈 Historial de precio</div>
        ${history.map(h => `
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:.88rem">
            <span style="color:${h.new_price > h.old_price ? 'var(--red)' : 'var(--green)'}">
              ${h.new_price > h.old_price ? '▲' : '▼'} $${fmt(h.new_price)}
            </span>
            <span style="color:var(--muted)">${new Date(h.changed_at).toLocaleDateString('es-AR')}</span>
          </div>`).join('')}
      </div>` : '';

    const myR = p.my_reaction || '';
    const myPts = currentUser ? currentUser.points : 0;
    const canEdit = myPts >= 50;
    const canVerify = myPts >= 200;

    // Fetch business to know if already verified
    let bizVerified = p.verified;

    const reporterBadgeHtml = p.reporter_badge
      ? `<span style="background:#f3e8ff;color:#6b21a8;border-radius:8px;padding:2px 8px;font-size:.72rem;font-weight:600;margin-left:4px">${badgeIcon(p.reporter_badge)} ${p.reporter_badge}</span>`
      : '';

    // Botón GPS — usa Google Maps si tiene lat/lng
    const gpsHtml = p.lat && p.lng ? `
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank"
           style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:11px;border-radius:12px;border:1.5px solid #4285F4;background:#fff;color:#4285F4;font-weight:700;font-size:.85rem;text-decoration:none">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#4285F4"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          Cómo llegar
        </a>
        <a href="https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes" target="_blank"
           style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:11px;border-radius:12px;border:1.5px solid #33ccff;background:#fff;color:#0099cc;font-weight:700;font-size:.85rem;text-decoration:none">
          🚗 Waze
        </a>
      </div>` : '';

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:2.5rem;font-weight:900;color:var(--green)">$${fmt(p.price)}</div>
        <div style="text-align:right">
          ${p.is_promotion ? '<div style="color:var(--yellow);font-weight:700">🏷️ En oferta</div>' : ''}
          <div style="font-size:.8rem;color:var(--muted)">Reportado por ${p.reporter_name}${reporterBadgeHtml}</div>
          <div style="font-size:.8rem;color:var(--muted)">${new Date(p.updated_at).toLocaleDateString('es-AR')}</div>
        </div>
      </div>

      <!-- Nombre y dirección del negocio -->
      <div style="background:var(--green-light);border-radius:12px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <div style="font-size:1.3rem">🏪</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:.92rem">${p.business_name}${p.verified ? ' <span style="color:var(--green);font-size:.78rem">✅ Verificado</span>' : ''}</div>
          ${p.address ? `<div style="color:var(--muted);font-size:.8rem">📍 ${p.address}</div>` : ''}
        </div>
      </div>

      ${gpsHtml}

      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="react-btn ${myR === 'confirmed' ? 'ok' : ''}" style="flex:1" onclick="react(${p.id},'confirmed',this)">✅ Sí, es correcto</button>
        <button class="react-btn ${myR === 'disputed' ? 'bad' : ''}" style="flex:1" onclick="react(${p.id},'disputed',this)">❌ El precio cambió</button>
      </div>
      <div style="font-size:.85rem;color:var(--muted);margin-bottom:16px">
        ✅ ${p.confirmed_count || 0} confirmaciones · ❌ ${p.disputed_count || 0} disputas
      </div>

      <!-- Acciones por nivel -->
      ${token ? `
      <div style="border-top:1px solid #f0f0f0;padding-top:14px;margin-bottom:4px">
        <div style="font-size:.8rem;color:var(--muted);font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">Acciones del negocio</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canEdit
            ? `<button onclick="openEditBiz(${p.business_id},'${esc(p.business_name)}','${esc(p.address||'')}','${esc(p.category||'')}')" style="flex:1;min-width:120px;padding:10px;border-radius:12px;border:1.5px solid var(--green);background:#fff;color:var(--green);font-weight:700;font-size:.82rem;cursor:pointer">✏️ Editar negocio</button>`
            : `<div style="flex:1;min-width:120px;padding:10px;border-radius:12px;border:1.5px solid #e0e0e0;background:#f9f9f9;color:var(--muted);font-size:.78rem;text-align:center">🔒 Editar negocio<br><span style="font-size:.72rem">Necesitás 50 pts (tenés ${myPts})</span></div>`
          }
          ${!bizVerified
            ? canVerify
              ? `<button onclick="verifyBiz(${p.business_id},this)" style="flex:1;min-width:120px;padding:10px;border-radius:12px;border:1.5px solid #f39c12;background:#fff;color:#856404;font-weight:700;font-size:.82rem;cursor:pointer">⭐ Verificar negocio</button>`
              : `<div style="flex:1;min-width:120px;padding:10px;border-radius:12px;border:1.5px solid #e0e0e0;background:#f9f9f9;color:var(--muted);font-size:.78rem;text-align:center">🔒 Verificar negocio<br><span style="font-size:.72rem">Necesitás 200 pts (tenés ${myPts})</span></div>`
            : `<div style="flex:1;min-width:120px;padding:10px;border-radius:12px;border:1.5px solid #d4edda;background:#d4edda;color:#155724;font-size:.82rem;text-align:center;font-weight:700">✅ Negocio verificado</div>`
          }
        </div>
      </div>` : ''}

      ${histHtml}
      <button class="btn-next" style="margin-top:16px" onclick="closeDetailAndReport(${p.product_id},'${esc(p.product_name)}',${p.business_id},'${esc(p.business_name)}')">
        📝 Actualizar este precio
      </button>`;
  } catch { body.innerHTML = '<div style="padding:20px;color:var(--muted)">No se pudo cargar el detalle.</div>'; }
}

function closeDetail(e) {
  if (e.target === document.getElementById('detail-bg')) {
    closeSheet('detail-bg');
  }
}

function closeDetailAndReport(prodId, prodName, bizId, bizName) {
  closeSheet('detail-bg', () => {
    selProductId = prodId; selProductName = prodName;
    selBizId = bizId; selBizName = bizName;
    goTab('report');
    goStep(3);
  });
}

// ── MAP ──────────────────────────────────────────
function initMap() {
  if (mapReady) { loadMapData(); return; }
  mapReady = true;
  map = L.map('map').setView([userLat, userLng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);
  map.on('moveend', loadMapData);
  loadMapData();

  // Load product filter pills for map
  api('GET', '/products/categories').then(cats => {
    const row = document.getElementById('map-pills');
    row.innerHTML = `<div class="pill active" onclick="loadMapData(null,this)">Todo</div>` +
      cats.map(c => `<div class="pill" onclick="loadMapData('${esc(c)}',this)">${c}</div>`).join('');
  });
}

let mapCatFilter = null;
async function loadMapData(cat, el) {
  if (cat !== undefined) {
    mapCatFilter = cat;
    document.querySelectorAll('#map-pills .pill').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');
  }

  try {
    const businesses = await api('GET', '/businesses');
    bizMarkers.forEach(m => map.removeLayer(m));
    bizMarkers = [];

    businesses.forEach(b => {
      const color = b.verified ? '#1a7a4a' : '#aaa';
      const m = L.circleMarker([b.lat, b.lng], {
        radius: b.price_count > 0 ? 11 : 7, color,
        fillColor: b.verified ? '#2ea865' : '#ccc', fillOpacity: .85, weight: 2
      }).addTo(map);
      m.bindPopup(`
        <div style="min-width:180px">
          <div style="font-weight:700;font-size:.95rem;margin-bottom:2px">${b.name}${b.verified ? ' ✅' : ''}</div>
          <div style="color:#888;font-size:.8rem;margin-bottom:6px">${b.category}${b.address ? ' · ' + b.address : ''}</div>
          <div style="color:#555;font-size:.8rem;margin-bottom:8px">📦 ${b.price_count || 0} precio(s) cargado(s)</div>
          <button onclick="openBizDetail(${b.id})" style="width:100%;background:#1a7a4a;color:#fff;border:none;border-radius:8px;padding:7px;font-size:.82rem;cursor:pointer;margin-bottom:6px;font-weight:700">Ver precios</button>
          <div style="display:flex;gap:5px">
            <a href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}" target="_blank"
               style="flex:1;display:block;text-align:center;padding:6px;border-radius:8px;border:1px solid #4285F4;color:#4285F4;font-size:.75rem;font-weight:700;text-decoration:none">
              📍 Maps
            </a>
            <a href="https://waze.com/ul?ll=${b.lat},${b.lng}&navigate=yes" target="_blank"
               style="flex:1;display:block;text-align:center;padding:6px;border-radius:8px;border:1px solid #33ccff;color:#0099cc;font-size:.75rem;font-weight:700;text-decoration:none">
              🚗 Waze
            </a>
          </div>
        </div>`);
      bizMarkers.push(m);
    });

    // Also populate map list
    const list = document.getElementById('map-list');
    const prices = await api('GET', '/prices');
    let filtered = prices;
    if (mapCatFilter) filtered = prices.filter(p => p.category === mapCatFilter);
    if (!filtered.length) { list.innerHTML = `<div class="empty"><div class="empty-icon">📍</div><h3>Sin precios en esta zona</h3><p>¡Reportá el primero!</p></div>`; return; }
    list.innerHTML = filtered.slice(0, 20).map(p => renderCard(p)).join('');
  } catch {}
}

async function openBizDetail(bizId) {
  const bg = document.getElementById('detail-bg');
  bg.classList.add('open');
  document.getElementById('det-title').textContent = 'Cargando...';
  document.getElementById('det-sub').textContent = '';
  document.getElementById('det-body').innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';
  try {
    const b = await api('GET', `/businesses/${bizId}`);
    document.getElementById('det-title').textContent = `🏪 ${b.name}`;
    document.getElementById('det-sub').textContent = `${b.category}${b.address ? ' · ' + b.address : ''}`;
    const pricesHtml = b.prices.length ? b.prices.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f5f5f5">
        <div><div style="font-weight:600">${p.product_name} <span style="color:var(--muted);font-size:.8rem">(${p.unit})</span></div></div>
        <div style="font-weight:900;color:var(--green);font-size:1.1rem">$${fmt(p.price)}</div>
      </div>`).join('') : '<div style="color:var(--muted);padding:12px 0">Sin precios cargados</div>';
    document.getElementById('det-body').innerHTML = pricesHtml +
      `<button class="btn-next" style="margin-top:16px" onclick="document.getElementById('detail-bg').classList.remove('open');selBizId=${bizId};selBizName='${esc(b.name)}';goTab('report');goStep(1)">
        <i class="fa fa-plus me-2"></i>Reportar precio en este negocio
      </button>`;
  } catch {}
}

// ── RANKING ──────────────────────────────────────
let rankingCat = null;
async function loadRanking(cat, el) {
  if (cat !== undefined) {
    rankingCat = cat;
    document.querySelectorAll('#ranking-pills .pill').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');
  }
  const list = document.getElementById('ranking-list');
  list.innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';

  // Load category pills if not yet loaded
  if (!document.getElementById('ranking-pills').children.length) {
    try {
      const cats = await api('GET', '/products/categories');
      document.getElementById('ranking-pills').innerHTML =
        `<div class="pill active" onclick="loadRanking(null,this)">Todo</div>` +
        cats.map(c => `<div class="pill" onclick="loadRanking('${esc(c)}',this)">${c}</div>`).join('');
    } catch {}
  }

  try {
    let url = '/ranking?limit=40';
    if (rankingCat) url += `&category=${encodeURIComponent(rankingCat)}`;
    if (rankZoneActive && userLat && userLng) {
      url += `&lat=${userLat}&lng=${userLng}&radius=5`;
    }
    const prices = await api('GET', url);
    if (!prices.length) { list.innerHTML = `<div class="empty"><div class="empty-icon">🏆</div><h3>Sin datos aún</h3><p>¡Sé el primero en reportar un precio!</p></div>`; return; }
    list.innerHTML = prices.map((p, i) => `
      <div class="rank-item" onclick="openDetail(${p.id})">
        <div class="rank-num ${i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : 'rn'}">${i < 3 ? ['🥇','🥈','🥉'][i] : i+1}</div>
        <div style="flex:1">
          <div style="font-weight:700">${p.product_name} <span style="color:var(--muted);font-size:.8rem;font-weight:400">${p.unit}</span>
            ${p.is_promotion ? '<span style="background:#fff3cd;color:#856404;border-radius:8px;padding:1px 7px;font-size:.72rem;font-weight:600;margin-left:4px">Oferta</span>' : ''}
          </div>
          <div style="color:var(--muted);font-size:.83rem"><i class="fa fa-store" style="font-size:.75rem;margin-right:3px"></i>${p.business_name}</div>
          <div style="color:var(--muted);font-size:.75rem">
            ${getFreshness(p.updated_at) === 'fresh' ? '🟢 Confirmado hoy' : getFreshness(p.updated_at) === 'recent' ? '🟡 Hace poco' : '🔴 Sin confirmar'}
            · ✅ ${p.confirmed_count || 0}
          </div>
        </div>
        <div style="font-size:1.5rem;font-weight:900;color:var(--green)">$${fmt(p.price)}</div>
      </div>`).join('');
  } catch { list.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><h3>Error cargando ranking</h3></div>`; }
}

// ── WIZARD ───────────────────────────────────────
function goStep(n) {
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
  for (let i = 1; i <= 3; i++) {
    const d = document.getElementById('dot-' + i);
    if (d) d.classList.toggle('done', i < n);
  }
  window.scrollTo(0, 0);
}

function resetReport() {
  if (!selBizId) { selProductId = null; selProductName = ''; selBizId = null; selBizName = ''; }
  isPromo = false; noStock = false;
  document.getElementById('chip-promo').classList.remove('active');
  document.getElementById('chip-stock').classList.remove('active');
  document.getElementById('price-val').value = '';
  document.getElementById('prod-search').value = '';
  document.getElementById('biz-search').value = '';
  document.getElementById('prod-results').innerHTML = '';
  document.getElementById('biz-results').innerHTML = '';
  document.getElementById('new-prod-area').style.display = 'none';
  document.getElementById('new-biz-area').style.display = 'none';

  // If we have biz pre-selected (from map), skip to step 1 (product selection)
  if (selBizId && selProductId) { updateStep3Context(); goStep(3); }
  else if (selBizId) { goStep(1); }
  else { goStep(1); }
}

// STEP 1 — Product search
async function searchProdStep(q) {
  clearTimeout(searchTimer);
  const res = document.getElementById('prod-results');
  const newArea = document.getElementById('new-prod-area');
  if (q.length < 2) { res.innerHTML = ''; newArea.style.display = 'none'; return; }
  searchTimer = setTimeout(async () => {
    try {
      const products = await api('GET', `/products?search=${encodeURIComponent(q)}`);
      if (!products.length) {
        res.innerHTML = '';
        newArea.style.display = 'block';
        return;
      }
      newArea.style.display = 'none';
      res.innerHTML = products.slice(0, 8).map(p => `
        <div class="option-item" onclick="selectProd(${p.id},'${esc(p.name)}','${p.unit}')">
          <div class="option-icon">📦</div>
          <div><div class="option-label">${p.name}</div><div class="option-sub">${p.unit} · ${p.category}</div></div>
        </div>`).join('') +
        `<div class="option-item" style="border-style:dashed;background:#fafafa" onclick="document.getElementById('new-prod-area').style.display='block';document.getElementById('prod-results').innerHTML=''">
          <div class="option-icon">➕</div>
          <div><div class="option-label">No está en la lista</div><div class="option-sub">Agregar producto nuevo</div></div>
        </div>`;
    } catch {}
  }, 280);
}

function selectProd(id, name, unit) {
  selProductId = id; selProductName = `${name} (${unit})`;
  goStep(2);
  // Auto-search biz if already had one
  if (selBizId) { updateStep3Context(); goStep(3); }
}

async function createAndSelectProd() {
  if (!token) { openAuth(); return; }
  const name = document.getElementById('np-name').value.trim();
  if (!name) { toast('Ingresá el nombre', 'err'); return; }
  try {
    const p = await api('POST', '/products', {
      name, category: document.getElementById('np-cat').value || 'General',
      unit: document.getElementById('np-unit').value
    });
    selectProd(p.id, p.name, p.unit);
    toast(p.already_existed ? 'Producto encontrado ✅' : '¡Producto nuevo agregado!');
  } catch (err) { toast(err.message, 'err'); }
}

// STEP 2 — Business search
async function searchBizStep(q) {
  clearTimeout(searchTimer);
  const res = document.getElementById('biz-results');
  const newArea = document.getElementById('new-biz-area');
  if (q.length < 2) { res.innerHTML = ''; newArea.style.display = 'none'; return; }
  searchTimer = setTimeout(async () => {
    try {
      const bizs = await api('GET', `/businesses?search=${encodeURIComponent(q)}`);
      if (!bizs.length) { res.innerHTML = ''; newArea.style.display = 'block'; return; }
      newArea.style.display = 'none';
      res.innerHTML = bizs.slice(0, 8).map(b => `
        <div class="option-item" onclick="selectBiz(${b.id},'${esc(b.name)}')">
          <div class="option-icon">🏪</div>
          <div><div class="option-label">${b.name}</div><div class="option-sub">${b.category}${b.address ? ' · ' + b.address : ''}</div></div>
        </div>`).join('') +
        `<div class="option-item" style="border-style:dashed;background:#fafafa" onclick="document.getElementById('new-biz-area').style.display='block';document.getElementById('biz-results').innerHTML=''">
          <div class="option-icon">➕</div>
          <div><div class="option-label">No está en la lista</div><div class="option-sub">Agregar negocio nuevo</div></div>
        </div>`;
    } catch {}
  }, 280);
}

function selectBiz(id, name) {
  selBizId = id; selBizName = name;
  updateStep3Context();
  goStep(3);
}

async function createAndSelectBiz() {
  if (!token) { openAuth(); return; }
  const name = document.getElementById('nb-name').value.trim();
  if (!name) { toast('Ingresá el nombre del negocio', 'err'); return; }
  try {
    const b = await api('POST', '/businesses', {
      name, category: document.getElementById('nb-cat').value,
      lat: userLat, lng: userLng
    });
    selectBiz(b.id, b.name);
    toast('¡Negocio agregado!');
  } catch (err) { toast(err.message, 'err'); }
}

// STEP 3
function updateStep3Context() {
  const ctx = document.getElementById('step3-context');
  if (ctx) ctx.textContent = `${selProductName} en ${selBizName}`;
}

function toggleChip(type) {
  if (type === 'promo') {
    isPromo = !isPromo;
    document.getElementById('chip-promo').classList.toggle('active', isPromo);
  } else {
    noStock = !noStock;
    document.getElementById('chip-stock').classList.toggle('active', noStock);
  }
}

async function submitReport() {
  if (!token) { openAuth(); return; }
  if (!selProductId) { toast('Seleccioná un producto primero', 'err'); goStep(1); return; }
  if (!selBizId) { toast('Seleccioná un negocio primero', 'err'); goStep(2); return; }
  const price = parseFloat(document.getElementById('price-val').value);
  if (!price || price <= 0) { toast('Ingresá un precio válido', 'err'); return; }

  try {
    const res = await api('POST', '/prices', {
      product_id: selProductId, business_id: selBizId,
      price, is_promotion: isPromo, out_of_stock: noStock
    });

    const msgs = {
      created: 'Precio nuevo publicado 🎉',
      confirmed: '¡Precio confirmado! La comunidad te lo agradece.',
      updated: res.message || 'Precio actualizado'
    };
    document.getElementById('res-price').textContent = `$${fmt(price)}`;
    document.getElementById('res-label').textContent = `${selProductName} en ${selBizName}`;
    document.getElementById('res-msg').textContent = msgs[res.action] || '¡Listo!';
    document.getElementById('res-pts').textContent = res.points_earned || 0;

    // Update points in UI
    if (currentUser) {
      currentUser.points = (currentUser.points || 0) + (res.points_earned || 0);
      localStorage.setItem('cp_user', JSON.stringify(currentUser));
      updateChip();
    }

    // Fetch updated badge
    try {
      const me = await api('GET', '/auth/me');
      document.getElementById('res-badge').textContent = `Tu nivel: ${me.badge}`;
      currentUser = { ...currentUser, ...me };
      localStorage.setItem('cp_user', JSON.stringify(currentUser));
    } catch {}

    selProductId = null; selProductName = ''; selBizId = null; selBizName = '';
    goStep(4);
    loadHomeFeed(); // Refresh feed in background
  } catch (err) { toast(err.message, 'err'); }
}

// ── PROFILE ──────────────────────────────────────
async function loadProfile() {
  if (!currentUser) {
    document.getElementById('pf-out').style.display = 'block';
    document.getElementById('pf-in').style.display = 'none';
    return;
  }
  document.getElementById('pf-out').style.display = 'none';
  document.getElementById('pf-in').style.display = 'block';
  try {
    const user = await api('GET', '/auth/me');
    currentUser = { ...currentUser, ...user };
    localStorage.setItem('cp_user', JSON.stringify(currentUser));
    document.getElementById('pf-initial').textContent = user.name[0].toUpperCase();
    document.getElementById('pf-name').textContent = user.name;
    document.getElementById('pf-badge').textContent = `🏅 ${user.badge}`;
    document.getElementById('pf-pts').textContent = user.points;
    document.getElementById('pf-reports').textContent = '—';
    document.getElementById('pf-confirms').textContent = '—';
    updateChip();
  } catch {}
}

function loadLevels() {
  const levels = [
    { pts: 0, name: 'Nuevo Explorador', icon: '🌱' },
    { pts: 20, name: 'Colaborador', icon: '🤝' },
    { pts: 50, name: 'Reportero Activo', icon: '📋' },
    { pts: 100, name: 'Cazador de Precios', icon: '🎯' },
    { pts: 200, name: 'Cazador Experto', icon: '⭐' },
    { pts: 500, name: 'Maestro de Precios', icon: '🏆' },
  ];
  const el = document.getElementById('levels-list');
  if (!el) return;
  el.innerHTML = levels.map(l => `
    <div class="info-row">
      <div style="font-size:1.4rem">${l.icon}</div>
      <div style="flex:1"><div style="font-weight:700;font-size:.9rem">${l.name}</div><div style="color:var(--muted);font-size:.78rem">Desde ${l.pts} puntos</div></div>
      ${currentUser && currentUser.points >= l.pts ? '<div style="color:var(--green);font-size:1rem">✓</div>' : ''}
    </div>`).join('');
}

// ── SHEET CLOSE HELPER ───────────────────────────
function closeSheet(id, callback) {
  const el = document.getElementById(id);
  el.classList.add('closing');
  setTimeout(() => {
    el.classList.remove('open', 'closing');
    if (callback) callback();
  }, 240);
}

// ── AUTH ──────────────────────────────────────────
function openAuth(defaultTab = 'login') {
  switchAuth(defaultTab);
  document.getElementById('auth-bg').classList.add('open');
}
function closeAuth(e) {
  if (e.target === document.getElementById('auth-bg')) {
    closeSheet('auth-bg');
  }
}
function switchAuth(tab) {
  document.getElementById('auth-login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-reg-form').style.display = tab === 'reg' ? 'block' : 'none';
  document.getElementById('atab-login').classList.toggle('active', tab === 'login');
  document.getElementById('atab-reg').classList.toggle('active', tab === 'reg');
}
function onChipClick() {
  if (currentUser) goTab('perfil');
  else openAuth();
}

async function doLogin() {
  const errEl = document.getElementById('login-err');
  errEl.style.display = 'none';
  try {
    const data = await api('POST', '/auth/login', {
      email: document.getElementById('l-email').value,
      password: document.getElementById('l-pass').value
    });
    setSession(data);
    closeSheet('auth-bg');
    toast(`¡Bienvenido, ${data.user.name}!`);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function doRegister() {
  const errEl = document.getElementById('reg-err');
  errEl.style.display = 'none';
  try {
    const data = await api('POST', '/auth/register', {
      name: document.getElementById('r-name').value,
      email: document.getElementById('r-email').value,
      password: document.getElementById('r-pass').value,
      role: document.getElementById('r-role').value
    });
    setSession(data);
    closeSheet('auth-bg');
    toast(`¡Bienvenido, ${data.user.name}! 🎉`);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

function setSession(data) {
  token = data.token;
  currentUser = data.user;
  localStorage.setItem('cp_token', token);
  localStorage.setItem('cp_user', JSON.stringify(currentUser));
  updateChip();
  loadLevels();
}

function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('cp_token');
  localStorage.removeItem('cp_user');
  updateChip();
  goTab('home');
  toast('Sesión cerrada', 'info');
}

function updateChip() {
  const label = document.getElementById('chip-label');
  if (currentUser) label.textContent = `${currentUser.name.split(' ')[0]} · ${currentUser.points || 0}pts`;
  else label.textContent = 'Ingresar';
  // Mostrar/ocultar botón admin
  const adminBtn = document.getElementById('nav-admin');
  if (adminBtn) adminBtn.style.display = (currentUser && currentUser.role === 'admin') ? 'flex' : 'none';
}

// ── AGREGAR NEGOCIO CON PIN ARRASTRABLE ──────────
let placementMarker = null;
let placementLat = null, placementLng = null;

function openAddBiz() {
  if (!token) { openAuth(); return; }

  // Asegurar que el mapa esté listo
  if (!mapReady) initMap();
  goTab('mapa');

  // Esperar un tick para que el mapa esté visible
  setTimeout(() => {
    enterPlacementMode();
  }, 100);
}

function enterPlacementMode() {
  // Ocultar controles normales del mapa
  document.getElementById('map-controls').style.display = 'none';
  document.getElementById('placement-overlay').style.display = 'block';
  document.getElementById('map-list').style.display = 'none';

  // Posición inicial del pin: ubicación del usuario o centro del mapa
  const startLat = userLat || map.getCenter().lat;
  const startLng = userLng || map.getCenter().lng;

  // Crear icono personalizado con animación de hint
  const pinIcon = L.divIcon({
    className: '',
    html: `<div id="placement-pin" style="
      width:40px;height:40px;
      background:var(--red,#e74c3c);
      border:3px solid #fff;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      box-shadow:0 4px 12px rgba(0,0,0,.35);
      cursor:grab;
      animation:pinHint 1.8s ease-in-out 0.6s 2;
    "></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });

  // Crear marcador arrastrable
  if (placementMarker) map.removeLayer(placementMarker);
  placementMarker = L.marker([startLat, startLng], {
    draggable: true,
    icon: pinIcon,
  }).addTo(map);

  placementLat = startLat;
  placementLng = startLng;

  // Centrar mapa en el pin
  map.setView([startLat, startLng], Math.max(map.getZoom(), 16));

  // Actualizar coordenadas cuando se mueve
  placementMarker.on('dragstart', () => {
    placementMarker.getElement().style.cursor = 'grabbing';
  });
  placementMarker.on('drag', e => {
    placementLat = e.latlng.lat;
    placementLng = e.latlng.lng;
  });
  placementMarker.on('dragend', e => {
    placementLat = e.target.getLatLng().lat;
    placementLng = e.target.getLatLng().lng;
    placementMarker.getElement().style.cursor = 'grab';
  });
}

function cancelPlacement() {
  if (placementMarker) { map.removeLayer(placementMarker); placementMarker = null; }
  document.getElementById('placement-overlay').style.display = 'none';
  document.getElementById('map-controls').style.display = 'block';
  document.getElementById('map-list').style.display = 'block';
}

function confirmPlacement() {
  if (!placementLat || !placementLng) {
    toast('Mové el pin a la ubicación del negocio', 'err');
    return;
  }
  // Guardar coordenadas y abrir formulario
  document.getElementById('ab-lat').value = placementLat;
  document.getElementById('ab-lng').value = placementLng;
  document.getElementById('ab-coords-label').textContent =
    `${placementLat.toFixed(5)}, ${placementLng.toFixed(5)}`;
  // Limpiar formulario
  document.getElementById('ab-name').value = '';
  document.getElementById('ab-cat').value = '';
  document.getElementById('ab-address').value = '';
  document.getElementById('ab-error').style.display = 'none';
  // Abrir sheet de datos
  document.getElementById('addbiz-bg').classList.add('open');
}

function closeAddBiz(e) {
  if (e.target === document.getElementById('addbiz-bg')) {
    closeSheet('addbiz-bg', cancelPlacement);
  }
}

async function submitAddBiz() {
  const name = document.getElementById('ab-name').value.trim();
  const cat = document.getElementById('ab-cat').value;
  const address = document.getElementById('ab-address').value.trim();
  const lat = parseFloat(document.getElementById('ab-lat').value);
  const lng = parseFloat(document.getElementById('ab-lng').value);
  const errEl = document.getElementById('ab-error');

  errEl.style.display = 'none';
  if (!name) { errEl.textContent = 'Ingresá el nombre del negocio'; errEl.style.display = 'block'; return; }
  if (!cat) { errEl.textContent = 'Seleccioná el tipo de negocio'; errEl.style.display = 'block'; return; }

  try {
    const biz = await api('POST', '/businesses', { name, category: cat, address: address || null, lat, lng });
    closeSheet('addbiz-bg', cancelPlacement);
    toast(`🏪 ¡${biz.name} agregado al mapa!`);
    if (mapReady) loadMapData();
  } catch (err) {
    errEl.textContent = err.message.includes('Ya existe')
      ? '⚠️ Ya existe un negocio con ese nombre en esa ubicación'
      : err.message;
    errEl.style.display = 'block';
  }
}

// ── RANKING SUB-TABS ─────────────────────────────
let rankTab = 'precios';
function switchRankTab(tab) {
  rankTab = tab;
  document.getElementById('rpanel-precios').style.display = tab === 'precios' ? 'block' : 'none';
  document.getElementById('rpanel-comunidad').style.display = tab === 'comunidad' ? 'block' : 'none';
  const btnPrecios = document.getElementById('rtab-precios');
  const btnComun = document.getElementById('rtab-comunidad');
  if (tab === 'precios') {
    btnPrecios.style.background = 'var(--green)'; btnPrecios.style.color = '#fff';
    btnComun.style.background = 'none'; btnComun.style.color = 'var(--muted)';
    loadRanking();
  } else {
    btnComun.style.background = 'var(--green)'; btnComun.style.color = '#fff';
    btnPrecios.style.background = 'none'; btnPrecios.style.color = 'var(--muted)';
    loadCommunityRanking();
  }
}

async function loadCommunityRanking() {
  const list = document.getElementById('community-list');
  list.innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';
  try {
    const users = await api('GET', '/ranking/users');
    if (!users.length) { list.innerHTML = `<div class="empty"><div class="empty-icon">👥</div><h3>Aún no hay usuarios</h3><p>¡Sé el primero en cargar precios!</p></div>`; return; }
    list.innerHTML = users.map((u, i) => `
      <div class="rank-item">
        <div class="rank-num ${i===0?'r1':i===1?'r2':i===2?'r3':'rn'}">${i<3?['🥇','🥈','🥉'][i]:i+1}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:.95rem">${u.name}</div>
          <div style="color:#6b21a8;font-size:.8rem;font-weight:600">${badgeIcon(u.badge)} ${u.badge || 'Nuevo Explorador'}</div>
          <div style="color:var(--muted);font-size:.78rem;margin-top:2px">📦 ${u.reports_count || 0} precios reportados</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:1.3rem;font-weight:900;color:var(--green)">${u.points}</div>
          <div style="font-size:.72rem;color:var(--muted)">puntos</div>
        </div>
      </div>`).join('');
  } catch { list.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><h3>Error cargando comunidad</h3></div>`; }
}

// ── EDITAR NEGOCIO (50+ pts) ──────────────────────
function openEditBiz(bizId, name, address, category) {
  const newName = prompt('Nombre del negocio:', name);
  if (newName === null) return;
  const newAddress = prompt('Dirección (dejá vacío para no cambiar):', address);
  if (newAddress === null) return;
  doEditBiz(bizId, newName.trim() || name, newAddress.trim() || address);
}

async function doEditBiz(bizId, name, address) {
  try {
    await api('PATCH', `/businesses/${bizId}`, { name, address });
    toast('✅ Negocio actualizado. ¡Gracias por mejorar la info!');
    closeSheet('detail-bg');
    if (mapReady) loadMapData();
  } catch (err) {
    if (err.message.includes('50 puntos')) {
      toast('Necesitás 50 puntos para editar negocios', 'err');
    } else {
      toast(err.message, 'err');
    }
  }
}

// ── VERIFICAR NEGOCIO (200+ pts) ─────────────────
async function verifyBiz(bizId, btn) {
  if (!confirm('¿Confirmás que este negocio existe y la información es correcta?\n\nGanás +15 puntos por verificarlo.')) return;
  try {
    const res = await api('POST', `/businesses/${bizId}/verify`);
    toast(`⭐ ${res.message}`);
    if (currentUser) { currentUser.points += 15; localStorage.setItem('cp_user', JSON.stringify(currentUser)); }
    btn.textContent = '✅ Negocio verificado';
    btn.style.borderColor = '#d4edda';
    btn.style.background = '#d4edda';
    btn.style.color = '#155724';
    btn.onclick = null;
    if (mapReady) loadMapData();
  } catch (err) {
    if (err.message.includes('200 puntos')) {
      toast('Necesitás 200 puntos para verificar negocios', 'err');
    } else {
      toast(err.message, 'err');
    }
  }
}

// ── IR A MI UBICACIÓN (mapa) ────────────────────
function goToMyLocation() {
  if (!mapReady) { initMap(); }
  if (!navigator.geolocation) { toast('Tu dispositivo no tiene GPS', 'err'); return; }
  toast('Buscando tu ubicación...', 'info');
  navigator.geolocation.getCurrentPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    map.setView([userLat, userLng], 16);
    // marcador temporal de ubicación
    L.circleMarker([userLat, userLng], { radius: 10, color: '#1a7a4a', fillColor: '#2ea865', fillOpacity: 0.8, weight: 3 })
      .addTo(map)
      .bindPopup('📍 Vos estás acá')
      .openPopup();
    toast('¡Ubicación encontrada!');
  }, () => toast('No se pudo obtener tu ubicación', 'err'));
}

// ── RANKING ZONA ────────────────────────────────
function toggleRankZone() {
  rankZoneActive = !rankZoneActive;
  const btn = document.getElementById('rank-zone-btn');
  const lbl = document.getElementById('rank-zone-label');
  if (rankZoneActive) {
    if (!navigator.geolocation) { toast('Tu dispositivo no tiene GPS', 'err'); rankZoneActive = false; return; }
    navigator.geolocation.getCurrentPosition(pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      btn.style.background = 'var(--green)';
      btn.style.color = '#fff';
      btn.textContent = '📍 Mi zona (5km)';
      lbl.textContent = 'Mostrando precios cerca tuyo';
      loadRanking();
    }, () => { toast('No se pudo obtener tu ubicación', 'err'); rankZoneActive = false; });
  } else {
    btn.style.background = '#fff';
    btn.style.color = 'var(--green)';
    btn.textContent = '🌍 Todo el país';
    lbl.textContent = 'Tocá para ver solo tu zona';
    loadRanking();
  }
}

// ── NEGOCIO DESDE WIZARD (con ubicación) ────────
function startWizardBizPlacement() {
  const name = document.getElementById('nb-name').value.trim();
  const cat = document.getElementById('nb-cat').value;
  if (!name) { toast('Escribí el nombre del negocio primero', 'err'); return; }
  // Guardamos datos pendientes
  wizardBizPending = { name, category: cat };
  // Vamos al mapa en modo placement
  if (!mapReady) initMap();
  goTab('mapa');
  setTimeout(() => {
    enterWizardPlacementMode();
  }, 150);
}

function enterWizardPlacementMode() {
  document.getElementById('map-controls').style.display = 'none';
  document.getElementById('placement-overlay').style.display = 'block';
  document.getElementById('map-list').style.display = 'none';

  const startLat = userLat || map.getCenter().lat;
  const startLng = userLng || map.getCenter().lng;

  const pinIcon = L.divIcon({
    className: '',
    html: `<div style="width:40px;height:40px;background:#f39c12;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 4px 12px rgba(0,0,0,.35);cursor:grab;"></div>`,
    iconSize: [40, 40], iconAnchor: [20, 40],
  });

  if (placementMarker) map.removeLayer(placementMarker);
  placementMarker = L.marker([startLat, startLng], { draggable: true, icon: pinIcon }).addTo(map);
  placementLat = startLat;
  placementLng = startLng;
  map.setView([startLat, startLng], Math.max(map.getZoom(), 16));

  placementMarker.on('drag', e => { placementLat = e.latlng.lat; placementLng = e.latlng.lng; });
  placementMarker.on('dragend', e => { placementLat = e.target.getLatLng().lat; placementLng = e.target.getLatLng().lng; });

  // Sobreescribir confirmación para flujo wizard
  document.querySelector('#placement-overlay button[onclick="confirmPlacement()"]')
    .setAttribute('onclick', 'confirmWizardPlacement()');
}

async function confirmWizardPlacement() {
  if (!placementLat || !placementLng) { toast('Mové el pin a la ubicación del negocio', 'err'); return; }
  if (!wizardBizPending) { cancelPlacement(); return; }

  // Restaurar botón para uso normal futuro
  const confirmBtn = document.querySelector('#placement-overlay button[onclick="confirmWizardPlacement()"]');
  if (confirmBtn) confirmBtn.setAttribute('onclick', 'confirmPlacement()');

  try {
    const biz = await api('POST', '/businesses', {
      name: wizardBizPending.name,
      category: wizardBizPending.category,
      lat: placementLat,
      lng: placementLng
    });
    cancelPlacement();
    wizardBizPending = null;
    // Seleccionar el negocio recién creado en el wizard
    selBizId = biz.id;
    selBizName = biz.name;
    toast(`🏪 ¡${biz.name} agregado!`);
    // Volver al wizard paso 3
    goTab('report');
    goStep(3);
    if (mapReady) loadMapData();
  } catch (err) {
    cancelPlacement();
    wizardBizPending = null;
    toast(err.message.includes('Ya existe') ? '⚠️ Ya existe ese negocio ahí' : err.message, 'err');
    goTab('report');
  }
}

// ═══════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════
let adminCurrentTab = 'stats';
let adminUsersCache = [];

function adminTab(name) {
  adminCurrentTab = name;
  ['stats', 'users', 'activity', 'bizz'].forEach(t => {
    document.getElementById('apanel-' + t).style.display = t === name ? 'block' : 'none';
    const btn = document.getElementById('atab-' + t);
    btn.style.background = t === name ? '#1a1a2e' : 'none';
    btn.style.color = t === name ? '#fff' : '#888';
  });
  if (name === 'stats')    loadAdminStats();
  if (name === 'users')    loadAdminUsers();
  if (name === 'activity') loadAdminActivity();
  if (name === 'bizz')     loadAdminBizz();
}

// ── STATS ────────────────────────────────────────
async function loadAdminStats() {
  const grid = document.getElementById('admin-stats-grid');
  grid.innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';
  try {
    const s = await api('GET', '/admin/stats');
    grid.innerHTML = [
      ['👥', 'Usuarios',       s.users],
      ['🏪', 'Negocios',       s.businesses],
      ['📦', 'Productos',      s.products],
      ['💰', 'Precios totales', s.prices],
      ['⚡', 'Precios hoy',    s.prices_hoy],
      ['👍', 'Reacciones',     s.reacciones],
    ].map(([icon, label, val]) => `
      <div style="background:#fff;border-radius:14px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.06)">
        <div style="font-size:1.6rem;margin-bottom:4px">${icon}</div>
        <div style="font-size:1.5rem;font-weight:900;color:#1a1a2e">${val}</div>
        <div style="font-size:.72rem;color:#888;margin-top:2px">${label}</div>
      </div>`).join('');
  } catch (err) {
    grid.innerHTML = `<div class="empty"><p>Error: ${err.message}</p></div>`;
  }
}

// ── USUARIOS ─────────────────────────────────────
async function loadAdminUsers() {
  const list = document.getElementById('admin-users-list');
  list.innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';
  try {
    adminUsersCache = await api('GET', '/admin/users');
    renderAdminUsers(adminUsersCache);
  } catch (err) {
    list.innerHTML = `<div class="empty"><p>Error: ${err.message}</p></div>`;
  }
}

function filterAdminUsers(q) {
  const filtered = q.length < 2
    ? adminUsersCache
    : adminUsersCache.filter(u =>
        u.name.toLowerCase().includes(q.toLowerCase()) ||
        u.email.toLowerCase().includes(q.toLowerCase())
      );
  renderAdminUsers(filtered);
}

function renderAdminUsers(users) {
  const list = document.getElementById('admin-users-list');
  if (!users.length) { list.innerHTML = '<div class="empty"><p>Sin resultados</p></div>'; return; }
  list.innerHTML = users.map(u => `
    <div style="background:#fff;border-radius:14px;padding:14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.05)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div>
          <div style="font-weight:700;font-size:.95rem">${esc(u.name)} ${u.blocked ? '🔒' : ''}</div>
          <div style="color:#888;font-size:.78rem">${esc(u.email)}</div>
        </div>
        <span style="background:${u.role==='admin'?'#1a1a2e':u.role==='merchant'?'#fff3cd':'#e8f5ee'};color:${u.role==='admin'?'#fff':u.role==='merchant'?'#856404':'#155724'};border-radius:10px;padding:3px 9px;font-size:.72rem;font-weight:700">${u.role}</span>
      </div>
      <div style="display:flex;gap:8px;font-size:.75rem;color:#888;margin-bottom:10px">
        <span>⭐ ${u.points} pts</span>
        <span>💰 ${u.prices_count || 0} precios</span>
        <span>👍 ${u.reactions_count || 0} reacciones</span>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="openAdminEdit(${u.id})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid #1a1a2e;background:#fff;color:#1a1a2e;font-weight:700;font-size:.78rem;cursor:pointer">✏️ Editar</button>
        <button onclick="toggleBlockUser(${u.id},${u.blocked?0:1})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid ${u.blocked?'#28a745':'#e74c3c'};background:${u.blocked?'#d4edda':'#fdecea'};color:${u.blocked?'#155724':'#c0392b'};font-weight:700;font-size:.78rem;cursor:pointer">${u.blocked?'🔓 Desbloquear':'🔒 Bloquear'}</button>
        <button onclick="deleteAdminUser(${u.id},'${esc(u.name)}')" style="padding:7px 10px;border-radius:8px;border:1.5px solid #e74c3c;background:#fdecea;color:#c0392b;font-weight:700;font-size:.78rem;cursor:pointer">🗑️</button>
      </div>
    </div>`).join('');
}

function openAdminEdit(userId) {
  const u = adminUsersCache.find(x => x.id === userId);
  if (!u) return;
  document.getElementById('edit-uid').value      = u.id;
  document.getElementById('edit-uname').value    = u.name;
  document.getElementById('edit-uemail').value   = u.email;
  document.getElementById('edit-urole').value    = u.role;
  document.getElementById('edit-upoints').value  = u.points;
  document.getElementById('edit-ubadge').value   = u.badge || '';
  document.getElementById('edit-ublocked').checked = !!u.blocked;
  document.getElementById('admin-edit-bg').style.display = 'flex';
}

function closeAdminEdit() {
  document.getElementById('admin-edit-bg').style.display = 'none';
}

async function saveAdminUser() {
  const id      = document.getElementById('edit-uid').value;
  const name    = document.getElementById('edit-uname').value.trim();
  const email   = document.getElementById('edit-uemail').value.trim();
  const role    = document.getElementById('edit-urole').value;
  const points  = parseInt(document.getElementById('edit-upoints').value) || 0;
  const badge   = document.getElementById('edit-ubadge').value.trim();
  const blocked = document.getElementById('edit-ublocked').checked;
  try {
    await api('PATCH', `/admin/users/${id}`, { name, email, role, points, badge, blocked });
    toast('Usuario actualizado');
    closeAdminEdit();
    loadAdminUsers();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function toggleBlockUser(userId, blockVal) {
  try {
    await api('PATCH', `/admin/users/${userId}`, { blocked: blockVal === 1 });
    toast(blockVal ? '🔒 Usuario bloqueado' : '🔓 Usuario desbloqueado');
    loadAdminUsers();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteAdminUser(userId, name) {
  if (!confirm(`¿Eliminar al usuario "${name}"? Esta acción no se puede deshacer.`)) return;
  try {
    await api('DELETE', `/admin/users/${userId}`);
    toast('Usuario eliminado');
    loadAdminUsers();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ── ACTIVIDAD ────────────────────────────────────
async function loadAdminActivity() {
  const list = document.getElementById('admin-activity-list');
  list.innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';
  try {
    const items = await api('GET', '/admin/activity');
    if (!items.length) { list.innerHTML = '<div class="empty"><p>Sin actividad</p></div>'; return; }
    list.innerHTML = items.map(p => `
      <div style="background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.05);border-left:4px solid ${p.is_promotion?'#f39c12':'#1a7a4a'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-weight:700;font-size:.9rem">${esc(p.product_name)}</div>
            <div style="color:#888;font-size:.78rem">en ${esc(p.business_name)}</div>
            <div style="color:#888;font-size:.75rem;margin-top:2px">por <b>${esc(p.user_name)}</b></div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.1rem;font-weight:900;color:#1a7a4a">$${Number(p.price).toLocaleString('es-AR')}</div>
            <div style="font-size:.68rem;color:#aaa">${new Date(p.created_at).toLocaleDateString('es-AR')}</div>
          </div>
        </div>
        <div style="margin-top:8px;text-align:right">
          <button onclick="deleteAdminPrice(${p.id})" style="padding:5px 12px;border-radius:8px;border:1.5px solid #e74c3c;background:#fdecea;color:#c0392b;font-size:.75rem;font-weight:700;cursor:pointer">🗑️ Eliminar</button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty"><p>Error: ${err.message}</p></div>`;
  }
}

async function deleteAdminPrice(priceId) {
  if (!confirm('¿Eliminar este precio?')) return;
  try {
    await api('DELETE', `/admin/prices/${priceId}`);
    toast('Precio eliminado');
    loadAdminActivity();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ── NEGOCIOS ─────────────────────────────────────
async function loadAdminBizz() {
  const list = document.getElementById('admin-bizz-list');
  list.innerHTML = '<div class="loader"><i class="fa fa-circle-notch fa-spin"></i></div>';
  try {
    const items = await api('GET', '/admin/businesses');
    if (!items.length) { list.innerHTML = '<div class="empty"><p>Sin negocios</p></div>'; return; }
    list.innerHTML = items.map(b => `
      <div style="background:#fff;border-radius:14px;padding:14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.05)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div>
            <div style="font-weight:700;font-size:.95rem">${esc(b.name)} ${b.verified?'⭐':''}</div>
            <div style="color:#888;font-size:.78rem">${esc(b.category)} · ${b.prices_count || 0} precios</div>
            ${b.owner_name ? `<div style="color:#888;font-size:.75rem">Dueño: ${esc(b.owner_name)}</div>` : ''}
          </div>
          <span style="background:${b.status==='open'?'#d4edda':'#f8d7da'};color:${b.status==='open'?'#155724':'#721c24'};border-radius:10px;padding:3px 9px;font-size:.72rem;font-weight:700">${b.status}</span>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="toggleVerifyAdminBiz(${b.id},${b.verified})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid ${b.verified?'#888':'#f39c12'};background:${b.verified?'#f8f8f8':'#fff8e1'};color:${b.verified?'#888':'#856404'};font-weight:700;font-size:.78rem;cursor:pointer">${b.verified?'⭐ Quitar verif.':'⭐ Verificar'}</button>
          <button onclick="deleteAdminBiz(${b.id},'${esc(b.name)}')" style="padding:7px 10px;border-radius:8px;border:1.5px solid #e74c3c;background:#fdecea;color:#c0392b;font-weight:700;font-size:.78rem;cursor:pointer">🗑️</button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty"><p>Error: ${err.message}</p></div>`;
  }
}

async function toggleVerifyAdminBiz(bizId, currentVerified) {
  try {
    await api('PATCH', `/admin/businesses/${bizId}`, { verified: !currentVerified });
    toast(currentVerified ? 'Verificación quitada' : '⭐ Negocio verificado');
    loadAdminBizz();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteAdminBiz(bizId, name) {
  if (!confirm(`¿Eliminar "${name}" y todos sus precios?`)) return;
  try {
    await api('DELETE', `/admin/businesses/${bizId}`);
    toast('Negocio eliminado');
    loadAdminBizz();
    if (mapReady) loadMapData();
  } catch (err) {
    toast(err.message, 'err');
  }
}
