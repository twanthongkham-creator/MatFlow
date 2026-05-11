// =========================================================================
// MatFlow API Service (Supabase Integration)
// =========================================================================

// 1. ตั้งค่าการเชื่อมต่อ Supabase
const supabaseUrl = 'https://bdjyxkkzbbzlmxszmvhx.supabase.co';
const supabaseKey = 'sb_publishable_inYG_le-QyiIvjkaUHXyfQ_Nvm4FpR2';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

const MF = (() => {

  // Helper: ยืนยันตัวตนผ่าน PIN
  async function validatePIN(empId, pin, requiredDept) {
    const { data: user, error } = await supabase.from('users').select('*').eq('emp_id', empId).single();
    if (error || !user) return { valid: false, msg: '❌ ไม่พบรหัสพนักงานนี้ในระบบ' };
    if (user.pin !== pin) return { valid: false, msg: '❌ รหัส PIN 4 หลัก ไม่ถูกต้อง' };
    if (requiredDept && user.department !== requiredDept && user.department !== 'Planning') {
      return { valid: false, msg: `❌ พนักงานไม่มีสิทธิ์เข้าถึง (ต้องเป็นแผนก ${requiredDept} หรือ Planning)` };
    }
    return { valid: true, name: user.name };
  }

  // Helper: สร้างเลขเอกสาร
  function generateDocNo(prefix) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${prefix}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${Math.floor(Math.random() * 100)}`;
  }

  return {
    getMasterData: async () => {
      const { data, error } = await supabase.from('master_raw_material').select('*');
      if (error) throw error;
      // Map ให้ตรงกับรูปแบบเดิม
      const formatted = data.map(item => ({
        code: item.code, productName: item.product_name, name: item.name, rmName: item.rm_name,
        unit: item.unit, packSize: item.unit_package, unitPerPack: item.unit_per_pack, packageType: item.package_type
      }));
      return { status: 'success', data: formatted };
    },

    getProducts: async () => {
      const { data, error } = await supabase.from('master_raw_material').select('product_name');
      if (error) throw error;
      const products = [...new Set(data.map(d => d.product_name).filter(Boolean))].sort();
      return { status: 'success', data: products };
    },

    getMonitorData: async () => {
      const { data, error } = await supabase.from('rm_monitoring').select('*').order('date_of_receive', { ascending: true });
      if (error) throw error;
      const formatted = data.map(item => ({
        id: item.id, code: item.mat_code, name: item.name, batch: item.batch,
        recDate: item.date_of_receive, mfg: item.mfg, exp: item.bbf, extExp: item.extended_bbf,
        qty: item.quantity, supplier: item.supplier, rmName: item.rm_name, rmCode: item.rm_code,
        unit: item.unit, unitPackage: item.unit_package
      }));
      return { status: 'success', data: formatted };
    },

    getDashboardData: async () => {
      // ดึงข้อมูลเพื่อมาคำนวณ Dashboard แบบเดียวกับ Code.gs
      const { data: monitorData } = await MF.getMonitorData();
      const { data: masterData } = await MF.getMasterData();
      
      let today = new Date();
      let expiryList = [];
      let stockMap = {};

      monitorData.forEach(item => {
        if (item.qty > 0) {
          stockMap[item.code] = (stockMap[item.code] || 0) + parseFloat(item.qty);
          let expDate = item.extExp ? new Date(item.extExp) : new Date(item.exp);
          if (!isNaN(expDate.getTime())) {
            let diffDays = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 31) expiryList.push({ name: item.name || item.rmName || item.code, batch: item.batch, days: diffDays });
          }
        }
      });
      expiryList.sort((a, b) => a.days - b.days);

      let productBOM = {};
      masterData.forEach(rm => {
        if (!productBOM[rm.productName]) productBOM[rm.productName] = [];
        productBOM[rm.productName].push(rm);
      });

      let capDetailsList = [];
      let productionCapacity = {};

      for (let pName in productBOM) {
        let maxCanProduce = Infinity;
        let bottleneckRM = "-";
        productBOM[pName].forEach(rm => {
          let currentStock = stockMap[rm.code] || 0;
          let reqPerUnit = (rm.unit && rm.unit.toUpperCase() === 'UN') ? 1 : (parseFloat(rm.packSize) / parseFloat(rm.unitPerPack || 1));
          if (reqPerUnit > 0) {
            let possible = Math.floor(currentStock / reqPerUnit);
            if (possible < maxCanProduce) { maxCanProduce = possible; bottleneckRM = rm.name || rm.code; }
          }
        });
        if (maxCanProduce === Infinity) maxCanProduce = 0;
        productionCapacity[pName] = maxCanProduce;
        capDetailsList.push({ pName: pName, potential: maxCanProduce, bottleneck: bottleneckRM });
      }
      capDetailsList.sort((a, b) => b.potential - a.potential);

      return { status: 'success', data: { productionCapacity, expiryTable: expiryList, capDetailsList } };
    },

    getUsers: async () => {
      const { data, error } = await supabase.from('users').select('*');
      if (error) throw error;
      return { status: 'success', data: data.map(u => ({ empId: u.emp_id, name: u.name, dept: u.department })) };
    },

    getRequests: async () => {
      const { data, error } = await supabase.from('matcall_requests').select('*').order('timestamp', { ascending: false });
      if (error) throw error;
      const formatted = data.map(item => ({
        reqNo: item.req_no, timestamp: item.timestamp, productTarget: item.product_target,
        targetQty: item.target_qty, reqBy: item.req_by, status: item.status,
        issueDoc: item.issue_doc, issueBy: item.issue_by, receiveBy: item.receive_by || ''
      }));
      return { status: 'success', data: formatted };
    },

    createRequest: async (payload) => {
      const auth = await validatePIN(payload.operator, payload.pin, 'Production');
      if (!auth.valid) return { status: 'error', message: auth.msg };
      
      const reqNo = generateDocNo('MTC');
      const rows = payload.items.map(item => ({
        req_no: reqNo, product_target: item.productTarget, target_qty: item.qty,
        req_by: auth.name, status: 'Pending'
      }));

      const { error } = await supabase.from('matcall_requests').insert(rows);
      if (error) throw error;
      return { status: 'success', reqNo: reqNo };
    },

    cancelRequest: async (reqNo, reason, operator, pin) => {
      const auth = await validatePIN(operator, pin, 'Production');
      if (!auth.valid) return { status: 'error', message: auth.msg };

      const { data: req } = await supabase.from('matcall_requests').select('status').eq('req_no', reqNo).single();
      if (!req) return { status: 'error', message: '❌ ไม่พบเลขที่ใบเบิกนี้' };
      if (req.status === 'Completed' || req.status === 'Issued') return { status: 'error', message: '❌ ยกเลิกไม่ได้ คลังจัดจ่ายแล้ว' };

      const { error } = await supabase.from('matcall_requests').update({ status: 'Cancelled', issue_doc: reason, issue_by: auth.name }).eq('req_no', reqNo);
      if (error) throw error;
      return { status: 'success' };
    },

    confirmReceive: async (reqNo, operator, pin) => {
      const auth = await validatePIN(operator, pin, 'Production');
      if (!auth.valid) return { status: 'error', message: auth.msg };

      const { error } = await supabase.from('matcall_requests').update({ status: 'Completed', receive_by: auth.name }).eq('req_no', reqNo);
      if (error) throw error;
      return { status: 'success' };
    },

    getTransactions: async () => {
      const { data, error } = await supabase.from('transactions').select('*').eq('transaction_type', 'OUT');
      if (error) throw error;
      return { status: 'success', data: data.map(tx => ({ reqNo: tx.doc_no, code: tx.mat_code, batch: tx.batch_no })) };
    },

    receive: async (items, operator) => {
      const docNo = generateDocNo('REC');
      let monitorRows = [];
      let txLogs = [];

      items.forEach(item => {
        monitorRows.push({
          mat_code: item.code, name: item.name, batch: item.batch, mfg: item.mfgDate,
          bbf: item.expDate, quantity: item.qty, supplier: item.supplier, rm_name: item.rmNameSource,
          rm_code: item.rmCodeSource, unit: item.unit, unit_package: item.unitPackage
        });
        txLogs.push({
          transaction_id: generateDocNo('TX'), transaction_type: 'IN', doc_no: docNo, mat_code: item.code,
          mat_name: item.name, batch_no: item.batch, quantity: item.qty, unit: item.unit,
          target_product: 'Stock In', operator: operator, remark: item.supplier
        });
      });

      await supabase.from('rm_monitoring').insert(monitorRows);
      await supabase.from('transactions').insert(txLogs);
      return { status: 'success', docNo: docNo };
    },

    issueMulti: async (items, operator, pin, reqNo) => {
      const auth = await validatePIN(operator, pin, 'Warehouse');
      if (!auth.valid) return { status: 'error', message: auth.msg };

      const docNo = generateDocNo('ISS');
      const { data: stockData } = await supabase.from('rm_monitoring').select('*').gt('quantity', 0).order('date_of_receive', { ascending: true });
      
      let txLogs = [];
      
      for (let req of items) {
        let allowedBatches = req.batch.split(',').map(b => b.trim());
        let qtyNeeded = parseFloat(req.cutQty);

        for (let stock of stockData) {
          if (stock.mat_code === req.code && qtyNeeded > 0) {
            if (allowedBatches.includes("FIFO") || allowedBatches.includes("Auto FIFO") || allowedBatches.includes(stock.batch)) {
              let cutUnits = Math.min(qtyNeeded, parseFloat(stock.quantity));
              
              // อัปเดตสต๊อก
              await supabase.from('rm_monitoring').update({ quantity: stock.quantity - cutUnits }).eq('id', stock.id);
              
              txLogs.push({
                transaction_id: generateDocNo('TX'), transaction_type: 'OUT', doc_no: reqNo || docNo, mat_code: stock.mat_code,
                mat_name: req.name, batch_no: stock.batch, quantity: cutUnits, unit: req.unit,
                target_product: req.productTarget, operator: auth.name, remark: `Issue ${cutUnits} ${req.unit} (Lot: ${stock.batch})`
              });

              qtyNeeded -= cutUnits;
            }
          }
        }
      }

      if (txLogs.length > 0) await supabase.from('transactions').insert(txLogs);
      if (reqNo) await supabase.from('matcall_requests').update({ status: 'Issued', issue_doc: docNo, issue_by: auth.name }).eq('req_no', reqNo);
      
      return { status: 'success', docNo: docNo };
    },

    updateMonitor: async (rowData) => {
      const { error } = await supabase.from('rm_monitoring').update({
        batch: rowData.batch, mfg: rowData.mfg, bbf: rowData.exp,
        extended_bbf: rowData.extExp, quantity: rowData.qty
      }).eq('id', rowData.id);
      if (error) throw error;
      return { status: 'success' };
    },

    deleteMonitor: async (rowId) => {
      const { error } = await supabase.from('rm_monitoring').delete().eq('id', rowId);
      if (error) throw error;
      return { status: 'success' };
    },
    
    // ฟังก์ชันแคชเดิม ปล่อยว่างไว้เพื่อไม่ให้โค้ดเก่าพัง (Supabase เร็วพอที่ไม่ต้องพึ่ง SessionStorage)
    bust: () => {}, bustAll: () => {}
  };
})();

// UI Helpers (เหมือนเดิม)
function mfToggleDrawer() {
  const d = document.getElementById('navDrawer'); const ic = document.getElementById('hIcon');
  if (!d) return; const open = d.classList.toggle('open');
  if (ic) ic.innerHTML = open ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' : '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
}
function mfShow(text = 'กำลังประมวลผล...') {
  const el = document.getElementById('loader'); const tx = document.getElementById('loaderText');
  if(tx) tx.textContent = text;
  if(el) el.classList.add('active');
}
function mfHide() {
  const el = document.getElementById('loader');
  if(el) el.classList.remove('active');
}
