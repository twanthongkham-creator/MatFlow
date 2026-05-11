// =========================================================================
// MatFlow API Service — Supabase Integration (Fixed v2.0)
// =========================================================================

const supabaseUrl = 'https://bdjyxkkzbbzlmxszmvhx.supabase.co';
const supabaseKey = 'sb_publishable_inYG_le-QyiIvjkaUHXyfQ_Nvm4FpR2';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

const MF = (() => {

  // ── PIN Validator ─────────────────────────────────────────────────────
  // pin อาจเป็น "" (empty) กรณี Manual Issue จาก Dashboard → ข้าม PIN check
  async function validatePIN(empId, pin, requiredDept) {
    const { data: user, error } = await supabase
      .from('users').select('*').eq('emp_id', empId).single();
    if (error || !user) return { valid: false, msg: '❌ ไม่พบรหัสพนักงานนี้ในระบบ' };
    if (pin && String(user.pin) !== String(pin))
      return { valid: false, msg: '❌ รหัส PIN 4 หลัก ไม่ถูกต้อง' };
    if (pin && requiredDept && user.department !== requiredDept && user.department !== 'Planning')
      return { valid: false, msg: `❌ พนักงานไม่มีสิทธิ์เข้าถึง (ต้องเป็นแผนก ${requiredDept} หรือ Planning)` };
    return { valid: true, name: user.name };
  }

  // ── Doc No Generator ──────────────────────────────────────────────────
  function generateDocNo(prefix) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${prefix}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${Math.floor(Math.random() * 100)}`;
  }

  return {

    // ── Master Raw Material ───────────────────────────────────────────────
    getMasterData: async () => {
      const { data, error } = await supabase.from('master_raw_material').select('*');
      if (error) throw error;
      return {
        status: 'success',
        data: data.map(item => ({
          code:        item.code,
          productName: item.product_name,
          name:        item.name,                              // ชื่อ RM เต็ม
          rmName:      item.rm_name,                          // ชื่อ RM ย่อ
          rmCode:      item.rm_code,
          category:    item.category,
          unit:        item.unit,
          // FIX #3: packSize = item.produced (น้ำหนัก/ปริมาณต่อแพ็ค) ไม่ใช่ unit_package (string)
          packSize:    parseFloat(item.produced)      || 1,
          unitPerPack: parseFloat(item.unit_per_pack) || 1,
          packageType: item.unit_package,                     // ชื่อแพ็ค เช่น "ถัง 3U"
          supplier:    item.supplier,
          netWeight:   item.net_weight,
          remark:      item.remark
        }))
      };
    },

    // ── Products List ─────────────────────────────────────────────────────
    getProducts: async () => {
      const { data, error } = await supabase
        .from('master_raw_material').select('product_name');
      if (error) throw error;
      return {
        status: 'success',
        data: [...new Set(data.map(d => d.product_name).filter(Boolean))].sort()
      };
    },

    // ── RM Monitoring (Stock) ─────────────────────────────────────────────
    getMonitorData: async () => {
      const { data, error } = await supabase
        .from('rm_monitoring').select('*')
        .order('date_of_receive', { ascending: true });
      if (error) throw error;
      return {
        status: 'success',
        data: data.map(item => ({
          id:          item.id,
          rowIdx:      item.id,           // FIX #1: ใช้ UUID แทน row index เดิม
          code:        item.mat_code,
          name:        item.rm_name,      // FIX #2: ไม่มีคอลัมน์ name ใน DB → ใช้ rm_name
          batch:       item.batch,
          recDate:     item.date_of_receive,
          mfg:         item.mfg,
          exp:         item.bbf,
          extExp:      item.extended_bbf,
          qty:         item.quantity,
          supplier:    item.supplier,
          rmName:      item.rm_name,
          rmCode:      item.rm_code,
          unit:        item.unit,
          unitPackage: item.unit_package
        }))
      };
    },

    // ── Dashboard Analytics ───────────────────────────────────────────────
    getDashboardData: async () => {
      const [monRes, masterRes] = await Promise.all([
        MF.getMonitorData(),
        MF.getMasterData()
      ]);
      const monitorData = monRes.data;
      const masterData  = masterRes.data;

      const today    = new Date();
      const stockMap = {};
      const expiryList = [];

      monitorData.forEach(item => {
        const qty = parseFloat(item.qty) || 0;
        if (qty > 0) {
          stockMap[item.code] = (stockMap[item.code] || 0) + qty;
          const effDate = item.extExp ? new Date(item.extExp) : new Date(item.exp);
          if (!isNaN(effDate.getTime())) {
            const diffDays = Math.ceil((effDate - today) / 864e5);
            if (diffDays <= 31)
              expiryList.push({ name: item.name || item.code, batch: item.batch, days: diffDays });
          }
        }
      });
      expiryList.sort((a, b) => a.days - b.days);

      // BOM Map
      const productBOM = {};
      masterData.forEach(rm => {
        if (!productBOM[rm.productName]) productBOM[rm.productName] = [];
        productBOM[rm.productName].push(rm);
      });

      // Production Capacity Calculation
      const capDetailsList = [];
      for (const pName in productBOM) {
        let maxPossible  = Infinity;
        let bottleneckRM = '—';
        productBOM[pName].forEach(rm => {
          const stock = stockMap[rm.code] || 0;
          // reqPerUnit = จำนวน RM ที่ต้องใช้ต่อ 1 unit ของผลิตภัณฑ์
          const reqPerUnit = rm.unit.toUpperCase() === 'UN'
            ? 1
            : (rm.packSize / rm.unitPerPack);
          if (reqPerUnit > 0) {
            const possible = Math.floor(stock / reqPerUnit);
            if (possible < maxPossible) {
              maxPossible  = possible;
              bottleneckRM = rm.name || rm.rmName || rm.code;
            }
          }
        });
        if (maxPossible === Infinity) maxPossible = 0;
        capDetailsList.push({ pName, potential: maxPossible, bottleneck: bottleneckRM });
      }
      capDetailsList.sort((a, b) => b.potential - a.potential);

      const productionCapacity = {};
      capDetailsList.forEach(d => { productionCapacity[d.pName] = d.potential; });

      return { status: 'success', data: { productionCapacity, expiryTable: expiryList, capDetailsList } };
    },

    // ── Users ─────────────────────────────────────────────────────────────
    getUsers: async () => {
      const { data, error } = await supabase.from('users').select('*');
      if (error) throw error;
      return {
        status: 'success',
        data: data.map(u => ({ empId: u.emp_id, name: u.name, dept: u.department }))
      };
    },

    // ── MatCall Requests ──────────────────────────────────────────────────
    getRequests: async () => {
      const { data, error } = await supabase
        .from('matcall_requests').select('*')
        .order('timestamp', { ascending: false });
      if (error) throw error;
      return {
        status: 'success',
        data: data.map(item => ({
          reqNo:         item.req_no,
          timestamp:     item.timestamp,
          productTarget: item.product_target,
          targetQty:     item.target_qty,
          reqBy:         item.req_by,
          status:        item.status,
          issueDoc:      item.issue_doc,
          issueBy:       item.issue_by,
          receiveBy:     item.receive_by || ''
        }))
      };
    },

    createRequest: async (payload) => {
      const auth = await validatePIN(payload.operator, payload.pin, 'Production');
      if (!auth.valid) return { status: 'error', message: auth.msg };
      const reqNo = generateDocNo('MTC');
      const rows  = payload.items.map(item => ({
        req_no: reqNo, product_target: item.productTarget,
        target_qty: item.qty, req_by: auth.name, status: 'Pending'
      }));
      const { error } = await supabase.from('matcall_requests').insert(rows);
      if (error) throw error;
      return { status: 'success', reqNo };
    },

    cancelRequest: async (reqNo, reason, operator, pin) => {
      const auth = await validatePIN(operator, pin, 'Production');
      if (!auth.valid) return { status: 'error', message: auth.msg };
      const { data: rows } = await supabase
        .from('matcall_requests').select('status').eq('req_no', reqNo).limit(1);
      if (!rows?.length) return { status: 'error', message: '❌ ไม่พบเลขที่ใบเบิกนี้' };
      if (['Completed', 'Issued'].includes(rows[0].status))
        return { status: 'error', message: '❌ ยกเลิกไม่ได้ คลังจัดจ่ายแล้ว' };
      const { error } = await supabase.from('matcall_requests')
        .update({ status: 'Cancelled', issue_doc: reason, issue_by: auth.name })
        .eq('req_no', reqNo);
      if (error) throw error;
      return { status: 'success' };
    },

    confirmReceive: async (reqNo, operator, pin) => {
      const auth = await validatePIN(operator, pin, 'Production');
      if (!auth.valid) return { status: 'error', message: auth.msg };
      const { error } = await supabase.from('matcall_requests')
        .update({ status: 'Completed', receive_by: auth.name })
        .eq('req_no', reqNo);
      if (error) throw error;
      return { status: 'success' };
    },

    // ── Transactions ──────────────────────────────────────────────────────
    getTransactions: async () => {
      const { data, error } = await supabase
        .from('transactions').select('*').eq('transaction_type', 'OUT');
      if (error) throw error;
      return {
        status: 'success',
        data: data.map(tx => ({ reqNo: tx.doc_no, code: tx.mat_code, batch: tx.batch_no }))
      };
    },

    // ── Receive (รับเข้าคลัง) ─────────────────────────────────────────────
    // FIX #4: แก้ field names ให้ตรงกับ DB schema ของ rm_monitoring
    receive: async (items, operator) => {
      const docNo = generateDocNo('REC');
      const now   = new Date().toISOString();

      const monitorRows = items.map(item => ({
        mat_code:        item.code,
        batch:           item.batch,
        date_of_receive: now,
        mfg:             item.mfgDate,
        bbf:             item.expDate,
        quantity:        item.qty,
        supplier:        item.supplier    || null,
        rm_name:         item.rmName      || item.name || null,   // FIX: rmName จาก master
        rm_code:         item.rmCode      || null,                // FIX: rmCode จาก master
        unit:            item.unit,
        unit_package:    item.packageType || null                 // FIX: packageType ไม่ใช่ unitPackage
      }));

      const txLogs = items.map(item => ({
        transaction_id:   generateDocNo('TX'),
        transaction_type: 'IN',
        doc_no:           docNo,
        mat_code:         item.code,
        mat_name:         item.name || item.rmName || item.code,
        batch_no:         item.batch,
        quantity:         item.qty,
        unit:             item.unit,
        target_product:   'Stock In',
        operator:         operator,
        remark:           item.supplier || 'Receive'
      }));

      const { error: e1 } = await supabase.from('rm_monitoring').insert(monitorRows);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('transactions').insert(txLogs);
      if (e2) throw e2;
      return { status: 'success', docNo };
    },

    // ── Issue Multi (ตัด Stock) ───────────────────────────────────────────
    // FIX #6: รองรับ 3 formats ของ batch string:
    //   "Auto FIFO"           → ตัด FIFO อัตโนมัติ
    //   "lot1,lot2"           → เลือก lot จาก warehouse.html
    //   "lot1:5.5,lot2:3.0"  → Manual issue พร้อมจำนวนจาก dashboard.html
    issueMulti: async (items, operator, pin, reqNo) => {
      const auth = await validatePIN(operator, pin, pin ? 'Warehouse' : null);
      if (!auth.valid) return { status: 'error', message: auth.msg };

      const docNo = generateDocNo('ISS');
      const { data: stockData, error: stockErr } = await supabase
        .from('rm_monitoring').select('*')
        .gt('quantity', 0)
        .order('date_of_receive', { ascending: true });
      if (stockErr) throw stockErr;

      const txLogs = [];

      for (const req of items) {
        const tokens   = req.batch.split(',').map(b => b.trim()).filter(Boolean);
        const isAutoFIFO = tokens.some(b => b === 'Auto FIFO' || b === 'FIFO');

        // สร้าง map { batchNo → maxCutQty } สำหรับ manual mode
        const manualMap  = {};
        let   isManual   = false;
        if (!isAutoFIFO) {
          tokens.forEach(tok => {
            if (tok.includes(':')) {
              isManual = true;
              const [b, q] = tok.split(':');
              manualMap[b.trim()] = parseFloat(q) || Infinity;
            } else {
              manualMap[tok] = Infinity;
            }
          });
        }

        let qtyNeeded = parseFloat(req.cutQty);

        for (const stock of stockData) {
          if (stock.mat_code !== req.code || qtyNeeded <= 0.0001) continue;

          const allowed = isAutoFIFO || manualMap.hasOwnProperty(stock.batch);
          if (!allowed) continue;

          const maxForBatch = isManual ? (manualMap[stock.batch] ?? Infinity) : Infinity;
          const cutUnits    = Math.min(qtyNeeded, parseFloat(stock.quantity), maxForBatch);
          if (cutUnits <= 0) continue;

          const { error: upErr } = await supabase
            .from('rm_monitoring')
            .update({ quantity: parseFloat(stock.quantity) - cutUnits })
            .eq('id', stock.id);
          if (upErr) throw upErr;

          txLogs.push({
            transaction_id:   generateDocNo('TX'),
            transaction_type: 'OUT',
            doc_no:           reqNo || docNo,
            mat_code:         stock.mat_code,
            mat_name:         req.name,
            batch_no:         stock.batch,
            quantity:         cutUnits,
            unit:             req.unit,
            target_product:   req.productTarget || '—',
            operator:         auth.name,
            remark:           `Issue ${cutUnits} ${req.unit} (Lot: ${stock.batch})`
          });

          qtyNeeded -= cutUnits;
        }
      }

      if (txLogs.length) {
        const { error: txErr } = await supabase.from('transactions').insert(txLogs);
        if (txErr) throw txErr;
      }

      // อัปเดตสถานะเฉพาะ MTC Request (ไม่ใช่ MANUAL-)
      if (reqNo && reqNo.startsWith('MTC-')) {
        const { error: updErr } = await supabase
          .from('matcall_requests')
          .update({ status: 'Issued', issue_doc: docNo, issue_by: auth.name })
          .eq('req_no', reqNo);
        if (updErr) throw updErr;
      }

      return { status: 'success', docNo };
    },

    // ── Update Monitor ────────────────────────────────────────────────────
    updateMonitor: async (rowData) => {
      const { error } = await supabase
        .from('rm_monitoring')
        .update({
          batch:        rowData.batch,
          mfg:          rowData.mfg,
          bbf:          rowData.exp,
          extended_bbf: rowData.extExp || null,
          quantity:     rowData.qty
        })
        .eq('id', rowData.id);   // id = UUID ถูกต้องแล้ว
      if (error) throw error;
      return { status: 'success' };
    },

    // ── Delete Monitor ────────────────────────────────────────────────────
    deleteMonitor: async (rowId) => {
      const { error } = await supabase
        .from('rm_monitoring').delete().eq('id', rowId);
      if (error) throw error;
      return { status: 'success' };
    },

    // ── Compatibility stubs (เดิมใช้ SessionStorage cache) ───────────────
    bust: () => {},
    bustAll: () => {}
  };
})();

// ── UI Helpers ────────────────────────────────────────────────────────────
function mfToggleDrawer() {
  const d  = document.getElementById('navDrawer');
  const ic = document.getElementById('hIcon');
  if (!d) return;
  const open = d.classList.toggle('open');
  if (ic) ic.innerHTML = open
    ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
    : '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
}

// FIX #5: ใช้ style.display แทน classList (ไม่มี CSS .loader.active)
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
