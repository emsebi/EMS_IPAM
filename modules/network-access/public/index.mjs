export function createUi(ctx){
 const {state,$,page,request,isAdmin,ensureInventory,escapeHtml,formatNumber,navActive,setRoute,translateTree,openPersonnelDialog,editPersonnel,toast}=ctx;
 async function openNetworkAccessPage(tab='mac'){
  if(!isAdmin())return toast('دسترسی فقط برای مدیر سیستم مجاز است.');
  tab=tab==='personnel'?'personnel':'mac';
  state.view='network-access';state.networkAccessTab=tab;state.currentSpaceId=null;state.data=null;
  navActive('networkAccess');setRoute(`/network-access/${tab}`);
  let rows=[];let total=0;
  if(tab==='mac'){await ensureInventory(true);rows=state.inventory.filter(h=>h.mac&&(!state.currentCompanyId||h.companyId===state.currentCompanyId));total=rows.length;}
  else{const result=await request(`/api/personnel?offset=${(state.personnelPage||0)*50}&limit=50`);rows=result.items||[];total=result.total||rows.length;}
  page.innerHTML=`<div class="headline"><div><div class="crumb">Network Access</div><h2>MAC و پرسنل</h2></div></div><div class="access-tabs" role="tablist"><button id="macTab" class="btn ${tab==='mac'?'primary':''}" role="tab" aria-selected="${tab==='mac'}">MAC</button><button id="personnelTab" class="btn ${tab==='personnel'?'primary':''}" role="tab" aria-selected="${tab==='personnel'}">پرسنل</button></div><section class="panel access-records"><div class="subtitle">${tab==='mac'?'MACهای ثبت‌شده در IPAM. خواندن از سوئیچ و اعمال دسترسی Radius در مراحل بعدی اضافه می‌شود.':'فهرست پرسنل برای ارتباط با دستگاه‌ها و MACها.'}</div><div class="row-actions"><b>${formatNumber(total)} مورد</b>${tab==='personnel'?'<button id="managePersonnel" class="btn primary">ثبت و مدیریت پرسنل</button>':''}</div><div class="inventory-table-wrap"><table class="inventory-table"><thead><tr>${(tab==='mac'?['MAC','IP','دستگاه','مالک','VLAN']:['نام','کد پرسنلی','واحد','شرکت','عملیات']).map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${rows.map(h=>tab==='mac'?`<tr><td class="ltr mono">${escapeHtml(h.mac)}</td><td class="ltr mono">${escapeHtml(h.ip)}</td><td>${escapeHtml(h.name)}</td><td>${escapeHtml(h.owner)}</td><td>${escapeHtml(h.vlan)}</td></tr>`:`<tr><td>${escapeHtml(h.fullName)}</td><td>${escapeHtml(h.employeeCode||'—')}</td><td>${escapeHtml(h.department)}</td><td>${escapeHtml(h.companyName||'—')}</td><td><button class="btn sm person-edit" data-id="${escapeHtml(h.id)}">ویرایش</button></td></tr>`).join('')||'<tr><td colspan="5">موردی ثبت نشده است.</td></tr>'}</tbody></table></div>${tab==='personnel'?`<div class="row-actions"><button id="personsPrevious" class="btn" ${(state.personnelPage||0)===0?'disabled':''}>قبلی</button><button id="personsNext" class="btn" ${((state.personnelPage||0)+1)*50>=total?'disabled':''}>بعدی</button></div>`:''}</section>`;
  $('macTab').addEventListener('click',()=>openNetworkAccessPage('mac'));
  $('personnelTab').addEventListener('click',()=>openNetworkAccessPage('personnel'));
  $('managePersonnel')?.addEventListener('click',()=>openPersonnelDialog());
  page.querySelectorAll('.person-edit').forEach(b=>b.addEventListener('click',async()=>{await openPersonnelDialog();editPersonnel(rows.find(p=>p.id===b.dataset.id));}));
  $('personsPrevious')?.addEventListener('click',()=>{state.personnelPage--;openNetworkAccessPage('personnel');});
  $('personsNext')?.addEventListener('click',()=>{state.personnelPage=(state.personnelPage||0)+1;openNetworkAccessPage('personnel');});
  translateTree(page);
 }
 return {openNetworkAccessPage};
}
