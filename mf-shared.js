/**
 * MatFlow Shared Module
 * Cache layer using sessionStorage to avoid redundant API calls between pages.
 * All pages import this via <script src="mf-shared.js"></script>
 */

const MF = (() => {
  const API = 'https://script.google.com/macros/s/AKfycbw2cy6sH-xwGsZoClvdXW1I4XoBbxT1DYOesqjMHpM1KUiRe0gZxjkPvWijne-PExQW/exec';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /* ── Low-level cache ── */
  function cGet(key) {
    try {
      const raw = sessionStorage.getItem('mf_' + key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem('mf_' + key); return null; }
      return data;
    } catch { return null; }
  }

  function cSet(key, data) {
    try { sessionStorage.setItem('mf_' + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
  }

  function cDel(key) {
    try { sessionStorage.removeItem('mf_' + key); } catch {}
  }

  /* ── API fetch with cache ── */
  async function fetchCached(action, params = '') {
    const cacheKey = action + params;
    const cached = cGet(cacheKey);
    if (cached) return cached;
    const url = `${API}?action=${action}${params}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === 'success') { cSet(cacheKey, json); }
    return json;
  }

  /* ── Invalidate write-affected caches ── */
  function invalidateInventory() {
    ['getMonitorData', 'getDashboardData', 'getRequests'].forEach(k => cDel(k));
  }
  function invalidateMaster() {
    ['getMasterData', 'getProducts', 'getDashboardData'].forEach(k => cDel(k));
  }

  /* ── Public API ── */
  return {
    /** Fetch product list (cached) */
    getProducts: () => fetchCached('getProducts'),

    /** Fetch full master data (cached) */
    getMasterData: () => fetchCached('getMasterData'),

    /** Fetch monitor/inventory data (cached) */
    getMonitorData: () => fetchCached('getMonitorData'),

    /** Fetch dashboard stats (cached) */
    getDashboardData: () => fetchCached('getDashboardData'),

    /** Fetch MATCALL Requests (cached) */
    getRequests: () => fetchCached('getRequests'),

    /** Evaluate multi production — always fresh, no cache */
    evaluateMulti: async (items) => {
      const url = `${API}?action=evaluateMulti&items=${encodeURIComponent(JSON.stringify(items))}`;
      const r = await fetch(url, { redirect: 'follow' });
      return r.json();
    },

    /** Create new MATCALL Request — invalidates request cache */
    createRequest: async (payload) => {
      const url = `${API}?action=createRequest&payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const r = await fetch(url, { redirect: 'follow' });
      const j = await r.json();
      if (j.status === 'success') cDel('getRequests'); // เคลียร์แคชหน้าผลิต
      return j;
    },

    /** Receive items — invalidates inventory cache */
    receive: async (items, operator) => {
      const url = `${API}?action=receive&operator=${encodeURIComponent(operator)}&items=${encodeURIComponent(JSON.stringify(items))}`;
      const r = await fetch(url, { redirect: 'follow' });
      const j = await r.json();
      if (j.status === 'success') invalidateInventory();
      return j;
    },

    /** Issue stock — invalidates inventory cache & sends reqNo if available */
    issueMulti: async (items, operator, reqNo) => {
      const payload = items.map(i => ({
        code:          i.code,
        cutQty:        i.cutQty,       // Unit ที่จะตัด (ไม่ใช่ Package)
        batch:         i.batch,
        name:          i.name,
        unit:          i.unit,
        productTarget: i.productTarget || 'Issue',
      }));
      
      let url = `${API}?action=issueMulti&operator=${encodeURIComponent(operator)}&items=${encodeURIComponent(JSON.stringify(payload))}`;
      // ถ้ามีการอ้างอิงใบเบิกมา ให้แนบ reqNo ส่งไปให้หลังบ้านอัปเดตด้วย
      if (reqNo) url += `&reqNo=${encodeURIComponent(reqNo)}`;
      
      const r = await fetch(url, { redirect: 'follow' });
      const j = await r.json();
      if (j.status === 'success') invalidateInventory();
      return j;
    },

    /** Update monitor row — invalidates inventory cache */
    updateMonitor: async (rowData) => {
      const r = await fetch(`${API}?action=updateMonitor&rowData=${encodeURIComponent(JSON.stringify(rowData))}`);
      const j = await r.json();
      if (j.status === 'success') invalidateInventory();
      return j;
    },

    /** Delete monitor row — invalidates inventory cache */
    deleteMonitor: async (rowIdx) => {
      const r = await fetch(`${API}?action=deleteMonitor&rowIdx=${rowIdx}`);
      const j = await r.json();
      if (j.status === 'success') invalidateInventory();
      return j;
    },

    /** Force-refresh a key (call before fetching fresh) */
    bust: (key) => cDel(key),
    bustAll: () => invalidateInventory(),
  };
})();

/* ── Mobile nav drawer toggle (shared) ── */
function mfToggleDrawer() {
  const d = document.getElementById('navDrawer');
  const ic = document.getElementById('hIcon');
  if (!d) return;
  const open = d.classList.toggle('open');
  if (ic) ic.innerHTML = open
    ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
    : '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
}

/* ── Shared loader helpers ── */
function mfShow(text = 'กำลังประมวลผล...') {
  const el = document.getElementById('loader');
  const tx = document.getElementById('loaderText');
  if (tx) tx.textContent = text;
  if (el) el.style.display = 'flex';
}
function mfHide() {
  const el = document.getElementById('loader');
  if (el) el.style.display = 'none';
}

/* ── Date formatting ── */
function mfFmtDisplay(v) {
  if (!v || v === '') return '—';
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleDateString('en-GB');
}
function mfFmtInput(v) {
  if (!v || v === '') return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toISOString().split('T')[0];
}
function mfFmtSlash(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}
