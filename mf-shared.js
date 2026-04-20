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
    ['getMonitorData', 'getDashboardData', 'getRequests', 'getTransactions'].forEach(k => cDel(k));
  }
  function invalidateMaster() {
    ['getMasterData', 'getProducts', 'getDashboardData'].forEach(k => cDel(k));
  }

  /* ── Public API ── */
  return {
    getProducts: () => fetchCached('getProducts'),
    getUsers: () => fetchCached('getUsers'),
    getMasterData: () => fetchCached('getMasterData'),
    getMonitorData: () => fetchCached('getMonitorData'),
    getDashboardData: () => fetchCached('getDashboardData'),
    getRequests: () => fetchCached('getRequests'),
    getTransactions: () => fetchCached('getTransactions'),

    /** 🚩 ฟังก์ชันใหม่: อัปเดตตัวเลขแจ้งเตือนบน Navigation Bar */
    updateNavBadges: async () => {
      try {
        const res = await MF.getRequests();
        if (res.status === 'success') {
          const data = res.data || [];
          
          // นับจำนวนเลขที่ใบเบิก (Unique ReqNo) ที่มีสถานะเป็น Pending
          const pendingItems = data.filter(r => r.status === 'Pending');
          const uniquePending = [...new Set(pendingItems.map(item => item.reqNo))].length;

          const updateBadge = (ids, count) => {
            ids.forEach(id => {
              const el = document.getElementById(id);
              if (el) {
                el.textContent = count;
                el.style.display = count > 0 ? 'inline-flex' : 'none';
              }
            });
          };

          // อัปเดตตัวเลขบนเมนู (ทั้ง Desktop และ Mobile Drawer)
          updateBadge(['nb-wh', 'mb-wh'], uniquePending); // คลังวัตถุดิบ
          updateBadge(['nb-pd', 'mb-pd'], uniquePending); // ฝ่ายผลิต
        }
      } catch (e) { console.warn("Badge Update Failed:", e); }
    },

    evaluateMulti: async (items) => {
      const url = `${API}?action=evaluateMulti&items=${encodeURIComponent(JSON.stringify(items))}`;
      const r = await fetch(url, { redirect: 'follow' });
      return r.json();
    },

    createRequest: async (payload) => {
      const url = `${API}?action=createRequest&payload=${encodeURIComponent(JSON.stringify(payload))}`;
      const r = await fetch(url, { redirect: 'follow' });
      const j = await r.json();
      if (j.status === 'success') {
          cDel('getRequests');
          MF.updateNavBadges(); // อัปเดตเมนูทันทีเมื่อสร้างสำเร็จ
      }
      return j;
    },

    cancelRequest: async (reqNo, reason, operator, pin) => {
      const url = `${API}?action=cancelRequest&reqNo=${encodeURIComponent(reqNo)}&reason=${encodeURIComponent(reason)}&operator=${encodeURIComponent(operator)}&pin=${encodeURIComponent(pin)}`;
      const r = await fetch(url, { redirect: 'follow' });
      const j = await r.json();
      if (j.status === 'success') {
          cDel('getRequests');
          MF.updateNavBadges(); // อัปเดตเมนูทันทีเมื่อยกเลิกสำเร็จ
      }
      return j;
    },

    receive: async (items, operator) => {
      const url = `${API}?action=receive&operator=${encodeURIComponent(operator)}&items=${encodeURIComponent(JSON.stringify(items))}`;
      const r = await fetch(url, { redirect: 'follow' });
      const j = await r.json();
      if (j.status === 'success') invalidateInventory();
      return j;
    },

    issueMulti: async (items, operator, pin, reqNo) => {
      const payload = items.map(i => ({
        code:          i.code,
        cutQty:        i.cutQty,      
        batch:         i.batch,
        name:          i.name,
        unit:          i.unit,
        productTarget: i.productTarget || 'Issue',
      }));
      
      let url = `${API}?action=issueMulti&operator=${encodeURIComponent(operator)}&pin=${encodeURIComponent(pin)}&items=${encodeURIComponent(JSON.stringify(payload))}`;
      if (reqNo) url += `&reqNo=${encodeURIComponent(reqNo)}`;
      
      const r = await fetch(url, { redirect: 'follow' });
      const j = await r.json();
      if (j.status === 'success') {
          invalidateInventory();
          MF.updateNavBadges(); // อัปเดตเมนูทันทีเมื่อจ่ายของสำเร็จ
      }
      return j;
    },

    updateMonitor: async (rowData) => {
      const r = await fetch(`${API}?action=updateMonitor&rowData=${encodeURIComponent(JSON.stringify(rowData))}`);
      const j = await r.json();
      if (j.status === 'success') invalidateInventory();
      return j;
    },

    deleteMonitor: async (rowIdx) => {
      const r = await fetch(`${API}?action=deleteMonitor&rowIdx=${rowIdx}`);
      const j = await r.json();
      if (j.status === 'success') invalidateInventory();
      return j;
    },

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

/* ── 🚩 สั่งอัปเดตตัวเลขแจ้งเตือนอัตโนมัติเมื่อเปิดหน้าเว็บ ── */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { 
      if (typeof MF !== 'undefined' && MF.updateNavBadges) {
          MF.updateNavBadges(); 
      }
  }, 300);
});
