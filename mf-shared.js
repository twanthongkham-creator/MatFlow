const MF = (() => {
  const API = 'https://script.google.com/macros/s/AKfycbw2cy6sH-xwGsZoClvdXW1I4XoBbxT1DYOesqjMHpM1KUiRe0gZxjkPvWijne-PExQW/exec';
  const CACHE_TTL = 5 * 60 * 1000; 

  function cGet(key) {
    try {
      const raw = sessionStorage.getItem('mf_' + key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem('mf_' + key); return null; }
      return data;
    } catch { return null; }
  }
  function cSet(key, data) { try { sessionStorage.setItem('mf_' + key, JSON.stringify({ ts: Date.now(), data })); } catch {} }
  function cDel(key) { try { sessionStorage.removeItem('mf_' + key); } catch {} }

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

  function invalidateInventory() { ['getMonitorData', 'getDashboardData', 'getRequests', 'getTransactions'].forEach(k => cDel(k)); }

  return {
    getProducts: () => fetchCached('getProducts'),
    getUsers: () => fetchCached('getUsers'),
    getMasterData: () => fetchCached('getMasterData'),
    getMonitorData: () => fetchCached('getMonitorData'),
    getDashboardData: () => fetchCached('getDashboardData'),
    getRequests: () => fetchCached('getRequests'),
    getTransactions: () => fetchCached('getTransactions'),

    updateNavBadges: async () => {
      try {
        const res = await MF.getRequests();
        if (res.status === 'success') {
          const data = res.data || [];
          
          const pendingItems = data.filter(r => r.status === 'Pending');
          const uniquePending = [...new Set(pendingItems.map(item => item.reqNo))].length;
          
          // 🚩 ให้ฝ่ายผลิตนับเฉพาะสถานะ Issued (งานที่คลังจ่ายแล้ว รอผลิตรับ)
          const issuedItems = data.filter(r => r.status === 'Issued');
          const uniqueIssued = [...new Set(issuedItems.map(item => item.reqNo))].length;

          const updateBadge = (ids, count) => {
            ids.forEach(id => {
              const el = document.getElementById(id);
              if (el) { el.textContent = count; el.style.display = count > 0 ? 'inline-flex' : 'none'; }
            });
          };

          updateBadge(['nb-wh', 'mb-wh'], uniquePending); // โกดังดู Pending
          updateBadge(['nb-pd', 'mb-pd'], uniqueIssued);  // ผลิตดู Issued
        }
      } catch (e) {}
    },

    evaluateMulti: async (items) => {
      const url = `${API}?action=evaluateMulti&items=${encodeURIComponent(JSON.stringify(items))}`;
      const r = await fetch(url, { redirect: 'follow' }); return r.json();
    },
    createRequest: async (payload) => {
      const url = `${API}?action=createRequest&payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const r = await fetch(url, { redirect: 'follow' }); const j = await r.json();
      if (j.status === 'success') { cDel('getRequests'); MF.updateNavBadges(); }
      return j;
    },
    cancelRequest: async (reqNo, reason, operator, pin) => {
      const url = `${API}?action=cancelRequest&reqNo=${encodeURIComponent(reqNo)}&reason=${encodeURIComponent(reason)}&operator=${encodeURIComponent(operator)}&pin=${encodeURIComponent(pin)}`;
      const r = await fetch(url, { redirect: 'follow' }); const j = await r.json();
      if (j.status === 'success') { cDel('getRequests'); MF.updateNavBadges(); }
      return j;
    },
    
    // 🚩 API ยืนยันรับของ
    confirmReceive: async (reqNo, operator, pin) => {
      const url = `${API}?action=confirmReceive&reqNo=${encodeURIComponent(reqNo)}&operator=${encodeURIComponent(operator)}&pin=${encodeURIComponent(pin)}`;
      const r = await fetch(url, { redirect: 'follow' }); const j = await r.json();
      if (j.status === 'success') { cDel('getRequests'); MF.updateNavBadges(); }
      return j;
    },

    receive: async (items, operator) => {
      const url = `${API}?action=receive&operator=${encodeURIComponent(operator)}&items=${encodeURIComponent(JSON.stringify(items))}`;
      const r = await fetch(url, { redirect: 'follow' }); const j = await r.json();
      if (j.status === 'success') invalidateInventory(); return j;
    },
    issueMulti: async (items, operator, pin, reqNo) => {
      const payload = items.map(i => ({ code: i.code, cutQty: i.cutQty, batch: i.batch, name: i.name, unit: i.unit, productTarget: i.productTarget || 'Issue' }));
      let url = `${API}?action=issueMulti&operator=${encodeURIComponent(operator)}&pin=${encodeURIComponent(pin)}&items=${encodeURIComponent(JSON.stringify(payload))}`;
      if (reqNo) url += `&reqNo=${encodeURIComponent(reqNo)}`;
      const r = await fetch(url, { redirect: 'follow' }); const j = await r.json();
      if (j.status === 'success') { invalidateInventory(); MF.updateNavBadges(); }
      return j;
    },
    updateMonitor: async (rowData) => {
      const r = await fetch(`${API}?action=updateMonitor&rowData=${encodeURIComponent(JSON.stringify(rowData))}`);
      const j = await r.json(); if (j.status === 'success') invalidateInventory(); return j;
    },
    deleteMonitor: async (rowIdx) => {
      const r = await fetch(`${API}?action=deleteMonitor&rowIdx=${rowIdx}`);
      const j = await r.json(); if (j.status === 'success') invalidateInventory(); return j;
    },
    bust: (key) => cDel(key), bustAll: () => invalidateInventory(),
  };
})();

function mfToggleDrawer() {
  const d = document.getElementById('navDrawer'); const ic = document.getElementById('hIcon');
  if (!d) return; const open = d.classList.toggle('open');
  if (ic) ic.innerHTML = open ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' : '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
}
function mfShow(text = 'กำลังประมวลผล...') {
  const el = document.getElementById('loader'); const tx = document.getElementById('loaderText');
  if (tx) tx.textContent = text; if (el) el.style.display = 'flex';
}
function mfHide() { const el = document.getElementById('loader'); if (el) el.style.display = 'none'; }

window.addEventListener('DOMContentLoaded', () => { setTimeout(() => { if (typeof MF !== 'undefined' && MF.updateNavBadges) MF.updateNavBadges(); }, 300); });
