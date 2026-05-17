// =========================================================================
// MatFlow API Service — Supabase Integration (v3.0)
// =========================================================================

const SUPA_URL = 'https://bdjyxkkzbbzlmxszmvhx.supabase.co';
const SUPA_KEY = 'sb_publishable_inYG_le-QyiIvjkaUHXyfQ_Nvm4FpR2';

let _client = null;
function db(){if(!_client){if(!window.supabase)throw new Error('Supabase SDK not loaded');_client=window.supabase.createClient(SUPA_URL,SUPA_KEY);}return _client;}

const MF=(()=>{
async function validatePIN(empId,pin,requiredDept){
  const{data:user,error}=await db().from('users').select('*').eq('emp_id',empId).single();
  if(error||!user)return{valid:false,msg:'ไม่พบรหัสพนักงานนี้ในระบบ'};
  if(pin&&String(user.pin)!==String(pin))return{valid:false,msg:'รหัส PIN 4 หลัก ไม่ถูกต้อง'};
  if(pin&&requiredDept&&user.department!==requiredDept&&user.department!=='Planning')
    return{valid:false,msg:`ต้องเป็นแผนก ${requiredDept} หรือ Planning`};
  return{valid:true,name:user.name};
}
function generateDocNo(prefix){
  const d=new Date(),pad=n=>String(n).padStart(2,'0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${Math.floor(Math.random()*100)}`;
}
return{
getMasterData:async()=>{
  const{data,error}=await db().from('master_raw_material').select('*');
  if(error)throw error;
  return{status:'success',data:data.map(item=>({
    code:item.code,productName:item.product_name,name:item.name,rmName:item.rm_name,rmCode:item.rm_code,
    category:item.category,unit:item.unit,packSize:parseFloat(item.produced)||1,
    unitPerPack:parseFloat(item.unit_per_pack)||1,packageType:item.unit_package,
    supplier:item.supplier,netWeight:item.net_weight,remark:item.remark
  }))};
},
getProducts:async()=>{
  const{data,error}=await db().from('master_raw_material').select('product_name');
  if(error)throw error;
  return{status:'success',data:[...new Set(data.map(d=>d.product_name).filter(Boolean))].sort()};
},
getMonitorData:async()=>{
  const{data,error}=await db().from('rm_monitoring').select('*').order('date_of_receive',{ascending:true});
  if(error)throw error;
  return{status:'success',data:data.map(item=>({
    id:item.id,rowIdx:item.id,code:item.mat_code,name:item.rm_name,batch:item.batch,
    recDate:item.date_of_receive,mfg:item.mfg,exp:item.bbf,extExp:item.extended_bbf,
    qty:item.quantity,supplier:item.supplier,rmName:item.rm_name,rmCode:item.rm_code,
    unit:item.unit,unitPackage:item.unit_package
  }))};
},
updateMonitor:async(rowData)=>{
  const{error}=await db().from('rm_monitoring').update({
    batch:rowData.batch,mfg:rowData.mfg,bbf:rowData.exp,
    extended_bbf:rowData.extExp||null,quantity:rowData.qty
  }).eq('id',rowData.id);
  if(error)throw error;
  return{status:'success'};
},
deleteMonitor:async(rowId)=>{
  const{error}=await db().from('rm_monitoring').delete().eq('id',rowId);
  if(error)throw error;
  return{status:'success'};
},
getUsers:async()=>{
  const{data,error}=await db().from('users').select('*');
  if(error)throw error;
  return{status:'success',data:data.map(u=>({empId:u.emp_id,name:u.name,dept:u.department}))};
},
getRequests:async()=>{
  const{data,error}=await db().from('matcall_requests').select('*').order('timestamp',{ascending:false});
  if(error)throw error;
  return{status:'success',data:data.map(item=>({
    reqNo:item.req_no,timestamp:item.timestamp,productTarget:item.product_target,
    targetQty:item.target_qty,reqBy:item.req_by,status:item.status,
    issueDoc:item.issue_doc,issueBy:item.issue_by,receiveBy:item.receive_by||''
  }))};
},
createRequest:async(payload)=>{
  const auth=await validatePIN(payload.operator,payload.pin,'Production');
  if(!auth.valid)return{status:'error',message:auth.msg};
  const reqNo=generateDocNo('MTC');
  const rows=payload.items.map(item=>({req_no:reqNo,product_target:item.productTarget,target_qty:item.qty,req_by:auth.name,status:'Pending'}));
  const{error}=await db().from('matcall_requests').insert(rows);
  if(error)throw error;
  return{status:'success',reqNo};
},
cancelRequest:async(reqNo,reason,operator,pin)=>{
  const auth=await validatePIN(operator,pin,'Production');
  if(!auth.valid)return{status:'error',message:auth.msg};
  const{data:rows}=await db().from('matcall_requests').select('status').eq('req_no',reqNo).limit(1);
  if(!rows?.length)return{status:'error',message:'ไม่พบเลขที่ใบเบิกนี้'};
  if(['Completed','Issued'].includes(rows[0].status))return{status:'error',message:'ยกเลิกไม่ได้ คลังจัดจ่ายแล้ว'};
  const{error}=await db().from('matcall_requests').update({status:'Cancelled',issue_doc:reason,issue_by:auth.name}).eq('req_no',reqNo);
  if(error)throw error;
  return{status:'success'};
},
confirmReceive:async(reqNo,operator,pin)=>{
  const auth=await validatePIN(operator,pin,'Production');
  if(!auth.valid)return{status:'error',message:auth.msg};
  const{error}=await db().from('matcall_requests').update({status:'Completed',receive_by:auth.name}).eq('req_no',reqNo);
  if(error)throw error;
  return{status:'success'};
},

// ━━ FIX: getTransactions — ALL IN+OUT, full fields
getTransactions:async()=>{
  const{data,error}=await db().from('transactions').select('*').order('transaction_id',{ascending:false}).limit(500);
  if(error)throw error;
  return{status:'success',data:data.map(tx=>({
    txId:tx.transaction_id,
    type:tx.transaction_type,
    docNo:tx.doc_no,
    code:tx.mat_code,
    name:tx.mat_name,
    batch:tx.batch_no,
    quantity:parseFloat(tx.quantity)||0,
    unit:tx.unit,
    targetProduct:tx.target_product,
    operator:tx.operator,
    remark:tx.remark
  }))};
},

// ━━ FIX: receive — with PIN validation
receive:async(items,operator,pin)=>{
  if(pin){
    const auth=await validatePIN(operator,pin,'Warehouse');
    if(!auth.valid)return{status:'error',message:auth.msg};
    operator=auth.name;
  }
  const docNo=generateDocNo('REC');
  const now=new Date().toISOString();
  const monitorRows=items.map(item=>({
    mat_code:item.code,batch:item.batch,date_of_receive:now,
    mfg:item.mfgDate,bbf:item.expDate,quantity:item.qty,
    supplier:item.supplier||null,rm_name:item.rmName||item.name||null,
    rm_code:item.rmCode||null,unit:item.unit,unit_package:item.packageType||null
  }));
  const txLogs=items.map(item=>({
    transaction_id:generateDocNo('TX'),transaction_type:'IN',doc_no:docNo,
    mat_code:item.code,mat_name:item.name||item.rmName||item.code,
    batch_no:item.batch,quantity:item.qty,unit:item.unit,
    target_product:'Stock In',operator:operator,remark:item.supplier||'Receive'
  }));
  const{error:e1}=await db().from('rm_monitoring').insert(monitorRows);
  if(e1)throw e1;
  const{error:e2}=await db().from('transactions').insert(txLogs);
  if(e2)throw e2;
  return{status:'success',docNo};
},

// ━━ issueMulti — FIFO auto-cut
issueMulti:async(items,operator,pin,reqNo)=>{
  const auth=await validatePIN(operator,pin,pin?'Warehouse':null);
  if(!auth.valid)return{status:'error',message:auth.msg};
  const docNo=generateDocNo('ISS');
  const{data:stock,error:sErr}=await db().from('rm_monitoring').select('*').gt('quantity',0).order('date_of_receive',{ascending:true});
  if(sErr)throw sErr;
  const txLogs=[];
  for(const req of items){
    const tokens=req.batch.split(',').map(b=>b.trim()).filter(Boolean);
    const isAuto=tokens.some(b=>b==='Auto FIFO'||b==='FIFO');
    const manualMap={};let isManual=false;
    if(!isAuto){tokens.forEach(tok=>{if(tok.includes(':')){ isManual=true;const[b,q]=tok.split(':');manualMap[b.trim()]=parseFloat(q)||Infinity;}else{manualMap[tok]=Infinity;}});}
    let need=parseFloat(req.cutQty);
    for(const s of stock){
      if(s.mat_code!==req.code||need<=0.0001)continue;
      if(!isAuto&&!manualMap.hasOwnProperty(s.batch))continue;
      const maxBatch=isManual?(manualMap[s.batch]??Infinity):Infinity;
      const cut=Math.min(need,parseFloat(s.quantity),maxBatch);
      if(cut<=0)continue;
      const{error:uErr}=await db().from('rm_monitoring').update({quantity:parseFloat(s.quantity)-cut}).eq('id',s.id);
      if(uErr)throw uErr;
      txLogs.push({transaction_id:generateDocNo('TX'),transaction_type:'OUT',doc_no:reqNo||docNo,
        mat_code:s.mat_code,mat_name:req.name,batch_no:s.batch,quantity:cut,unit:req.unit,
        target_product:req.productTarget||'—',operator:auth.name,remark:`Issue ${cut} ${req.unit} (Lot: ${s.batch})`});
      need-=cut;
    }
  }
  if(txLogs.length){const{error:tErr}=await db().from('transactions').insert(txLogs);if(tErr)throw tErr;}
  if(reqNo&&reqNo.startsWith('MTC-')){
    const{error:uErr}=await db().from('matcall_requests').update({status:'Issued',issue_doc:docNo,issue_by:auth.name}).eq('req_no',reqNo);
    if(uErr)throw uErr;
  }
  return{status:'success',docNo};
},

getDashboardData:async()=>{
  const[monRes,masterRes]=await Promise.all([MF.getMonitorData(),MF.getMasterData()]);
  const monitorData=monRes.data,masterData=masterRes.data,today=new Date(),stockMap={},expiryList=[];
  monitorData.forEach(item=>{const qty=parseFloat(item.qty)||0;if(qty>0){stockMap[item.code]=(stockMap[item.code]||0)+qty;const eff=item.extExp?new Date(item.extExp):new Date(item.exp);if(!isNaN(eff)){const days=Math.ceil((eff-today)/864e5);if(days<=31)expiryList.push({name:item.name||item.code,batch:item.batch,days});}}});
  expiryList.sort((a,b)=>a.days-b.days);
  const productBOM={};
  masterData.forEach(rm=>{if(!productBOM[rm.productName])productBOM[rm.productName]=[];productBOM[rm.productName].push(rm);});
  const capDetailsList=[];
  for(const pName in productBOM){let maxPossible=Infinity,bottleneckRM='—';productBOM[pName].forEach(rm=>{const stock=stockMap[rm.code]||0;const req=rm.unit.toUpperCase()==='UN'?1:(rm.packSize/rm.unitPerPack);if(req>0){const possible=Math.floor(stock/req);if(possible<maxPossible){maxPossible=possible;bottleneckRM=rm.name||rm.code;}}});if(maxPossible===Infinity)maxPossible=0;capDetailsList.push({pName,potential:maxPossible,bottleneck:bottleneckRM});}
  capDetailsList.sort((a,b)=>b.potential-a.potential);
  const productionCapacity={};capDetailsList.forEach(d=>{productionCapacity[d.pName]=d.potential;});
  return{status:'success',data:{productionCapacity,expiryTable:expiryList,capDetailsList}};
},

bust:()=>{},bustAll:()=>{}
};
})();

// ════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════════════════════════════════

function mfToggleDrawer(){
  const sidebar=document.getElementById('sidebar');
  const overlay=document.getElementById('sbOverlay');
  if(!sidebar)return;
  const isOpen=sidebar.classList.toggle('open');
  if(overlay)overlay.classList.toggle('show',isOpen);
  const ico=document.getElementById('pgToggleIco');
  if(ico){ico.innerHTML=isOpen?'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>':'<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';}
}

document.addEventListener('DOMContentLoaded',()=>{
  const overlay=document.getElementById('sbOverlay');
  if(overlay)overlay.addEventListener('click',mfToggleDrawer);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){const sidebar=document.getElementById('sidebar');if(sidebar&&sidebar.classList.contains('open'))mfToggleDrawer();}});
});

function mfShow(text='กำลังประมวลผล...'){
  const el=document.getElementById('loader');
  const tx=document.getElementById('loaderText');
  if(tx)tx.textContent=text;
  if(el)el.style.display='flex';
}
function mfHide(){const el=document.getElementById('loader');if(el)el.style.display='none';}

function mfToggleDesktopSidebar(){
  const sidebar=document.getElementById('sidebar');
  if(!sidebar)return;
  sidebar.classList.toggle('collapsed');
  localStorage.setItem('mf_sidebar_collapsed',sidebar.classList.contains('collapsed'));
}

document.addEventListener('DOMContentLoaded',()=>{
  const sidebar=document.getElementById('sidebar');
  if(sidebar&&localStorage.getItem('mf_sidebar_collapsed')==='true')sidebar.classList.add('collapsed');
});
