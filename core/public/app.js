const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = { user:null, modules:[], searchItems:[], searchIndex:-1, page:'dashboard', companies:[], sites:[] };

async function api(path, options={}) {
  const init = { credentials:'same-origin', ...options, headers:{'content-type':'application/json', ...(options.headers||{})} };
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status:res.status, data });
  return data;
}

function escapeHtml(v='') { return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function fmtDate(v){ if(!v) return '-'; try{return new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}catch{return new Date(v).toLocaleString();} }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.add('hidden'),2600); }
function roleLabel(r){ return ({admin:'Administrator',support:'Support',helpdesk:'Helpdesk',viewer:'Viewer'})[r] || r; }

async function init(){
  bindStatic();
  try {
    const me = await api('/api/me');
    state.user = me.user; showApp();
  } catch { showLogin(); }
}

function showLogin(){ $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); setTimeout(()=>$('#loginPass').focus(),50); }
async function showApp(){
  $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  $('#profileName').textContent = state.user.display_name || state.user.username;
  $('#profileRole').textContent = roleLabel(state.user.role);
  const mods = await api('/api/modules'); state.modules = mods.modules || []; renderModuleNav();
  go('dashboard');
}

function bindStatic(){
  $('#loginForm').addEventListener('submit', async e=>{
    e.preventDefault(); $('#loginError').textContent='';
    try { const r=await api('/api/auth/login',{method:'POST',body:{username:$('#loginUser').value,password:$('#loginPass').value}}); state.user=r.user; await showApp(); }
    catch(err){ $('#loginError').textContent=err.message; }
  });
  $('#mainNav').addEventListener('click', e=>{ const b=e.target.closest('[data-page]'); if(b && !b.classList.contains('disabled')) go(b.dataset.page); const m=e.target.closest('[data-module]'); if(m && !m.classList.contains('disabled')) openModule(m.dataset.module); });
  document.body.addEventListener('click', e=>{ const g=e.target.closest('[data-go]'); if(g) go(g.dataset.go); const a=e.target.closest('[data-action]'); if(a?.dataset.action==='backup') createBackup(); });
  $('#settingsNav').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(!b)return; $$('#settingsNav button').forEach(x=>x.classList.toggle('active',x===b)); renderSettings(b.dataset.tab);});
  $('#modalClose').onclick=closeModal; $('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal();});
  $('#addCompanyBtn').onclick=companyModal; $('#addSiteBtn').onclick=siteModal; $('#addDeviceBtn').onclick=deviceModal; $('#addPersonBtn').onclick=personModal;
  $('#companyFilter').addEventListener('input',renderCompaniesFiltered);
  $('#deviceFilter').addEventListener('input', debounce(loadDevices,180));
  $('#personFilter').addEventListener('input', debounce(loadPersonnel,180));
  bindGlobalSearch();
  document.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#globalSearch').focus();} if(e.key==='Escape'){ $('#searchResults').classList.add('hidden'); closeModal(); }});
}

function renderModuleNav(){
  const root=$('#moduleNav'); const planned=[['IPAM','IP Management'],['Radio','Radio Map'],['RADIUS','RADIUS / AAA'],['Network Map','Network Map'],['MAC Finder','MAC Finder'],['Network Access','Network Access']];
  const installed=new Map(state.modules.map(m=>[m.name,m]));
  root.innerHTML = planned.map(([name,label])=>{
    const m=installed.get(name); if(m?.navigation) return `<button data-module="${escapeHtml(m.id)}" class="nav-item"><span>${escapeHtml(m.navigation.icon||'◇')}</span><b>${escapeHtml(m.navigation.label||label)}</b></button>`;
    return `<button class="nav-item disabled" title="Install the ${escapeHtml(label)} module"><span>◇</span><b>${escapeHtml(label)}</b></button>`;
  }).join('');
}


function openModule(moduleId){
  const m=state.modules.find(x=>x.id===moduleId); if(!m)return;
  state.page='module'; $$('.page').forEach(p=>p.classList.remove('active')); $('#page-module').classList.add('active');
  $$('#mainNav .nav-item').forEach(b=>b.classList.toggle('active',b.dataset.module===moduleId));
  $('#crumbCurrent').textContent=m.navigation?.label||m.name||moduleId;
  $('#moduleFrame').src=`/m/${encodeURIComponent(moduleId)}/`;
}

async function go(page){
  state.page=page; $$('.page').forEach(p=>p.classList.remove('active')); $(`#page-${page}`)?.classList.add('active');
  $$('#mainNav .nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('#crumbCurrent').textContent = ({dashboard:'Dashboard',companies:'Companies & Sites',inventory:'Device Inventory',personnel:'Personnel',settings:'Settings',audit:'Audit & Logs'})[page] || page;
  if(page==='dashboard') await loadDashboard();
  if(page==='companies') await loadCompanies();
  if(page==='inventory') await loadDevices();
  if(page==='personnel') await loadPersonnel();
  if(page==='settings') renderSettings('general');
  if(page==='audit') await loadAudit();
}

async function loadDashboard(){
  const d=await api('/api/dashboard');
  const cards=[['▦',d.counts.companies,'Companies'],['⌂',d.counts.sites,'Sites / Branches'],['♙',d.counts.personnel,'Personnel'],['▣',d.counts.devices,'Devices'],['⚿',d.counts.users,'Panel Users']];
  $('#summaryCards').innerHTML=cards.map(c=>`<div class="summary-card"><div class="summary-icon">${c[0]}</div><div><strong>${c[1]}</strong><span>${c[2]}</span></div></div>`).join('');
  const actual=d.modules||[];
  const planned=[['IPAM','IP address & subnet management'],['Radio','AP / Station tree synced with IPAM'],['RADIUS','AAA and device administration'],['Network Map','Read-only discovery and topology'],['MAC Finder','Current and historical MAC location'],['Network Access','MAB / 802.1X access control']];
  $('#moduleCards').innerHTML=planned.map(([name,desc])=>{
    const m=actual.find(x=>x.name===name); return `<div class="module-card"><div class="module-icon">◇</div><div><h3>${name}</h3><p>${desc}</p></div><span class="state ${m?'ready':'planned'}">${m?'Installed':'Planned'}</span></div>`;
  }).join('');
  $('#recentAudit').innerHTML=(d.recentAudit?.length?d.recentAudit:[{action:'Core initialized',entity_type:'system',created_at:new Date()}]).map(x=>`<div class="activity-item"><i></i><div><b>${escapeHtml(x.action)}</b><small>${escapeHtml(x.entity_type)}</small></div><small>${fmtDate(x.created_at)}</small></div>`).join('');
}

async function loadCompanies(){
  const [c,s]=await Promise.all([api('/api/companies'),api('/api/sites')]); state.companies=c.items; state.sites=s.items; renderCompaniesFiltered();
}
function renderCompaniesFiltered(){
  const q=($('#companyFilter')?.value||'').toLowerCase(); const rows=state.companies.filter(x=>`${x.name} ${x.code}`.toLowerCase().includes(q));
  $('#companiesTable').innerHTML=table(['Company','Code','Sites','Status','Created'], rows.map(x=>[x.name,x.code||'-',x.site_count,`<span class="chip green">Active</span>`,fmtDate(x.created_at)]));
}

async function loadDevices(){
  const q=$('#deviceFilter')?.value||''; const r=await api('/api/devices?q='+encodeURIComponent(q));
  $('#devicesTable').innerHTML=table(['Name','Management IP','MAC','Type','Vendor / Model','Owner','Site','Status'], r.items.map(x=>[
    `<b>${escapeHtml(x.name)}</b>`,escapeHtml(x.management_ip||'-'),escapeHtml(x.mac||'-'),escapeHtml(x.device_type||'-'),escapeHtml([x.vendor,x.model].filter(Boolean).join(' ')||'-'),escapeHtml(x.owner_name||x.owner_text||'-'),escapeHtml(x.site_name||'-'),`<span class="chip ${x.status==='active'?'green':'gray'}">${escapeHtml(x.status)}</span>`
  ]));
}
async function loadPersonnel(){
  const q=$('#personFilter')?.value||''; const r=await api('/api/personnel?q='+encodeURIComponent(q));
  $('#personnelTable').innerHTML=table(['Employee Code','Full Name','Phone','Department','Company','Site','Status'],r.items.map(x=>[escapeHtml(x.employee_code),`<b>${escapeHtml(x.full_name)}</b>`,escapeHtml(x.phone||'-'),escapeHtml(x.department||'-'),escapeHtml(x.company_name||'-'),escapeHtml(x.site_name||'-'),'<span class="chip green">Active</span>']));
}
async function loadAudit(){ const r=await api('/api/audit'); $('#auditTable').innerHTML=table(['Time','User','Action','Entity','Source IP'],r.items.map(x=>[fmtDate(x.created_at),escapeHtml(x.username||'system'),escapeHtml(x.action),escapeHtml(`${x.entity_type}${x.entity_id?' · '+x.entity_id:''}`),escapeHtml(x.source_ip||'-')])); }

function table(headers,rows){ return `<table class="data-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" style="text-align:center;color:#7a8999;padding:32px">No records yet</td></tr>`}</tbody></table>`; }

function openModal(title,html,onSubmit){ $('#modalTitle').textContent=title; const form=$('#modalForm'); form.innerHTML=html; form.onsubmit=async e=>{e.preventDefault(); try{await onSubmit(new FormData(form));closeModal();toast('Saved successfully'); if(state.page==='companies')loadCompanies(); if(state.page==='inventory')loadDevices(); if(state.page==='personnel')loadPersonnel();}catch(err){toast(err.message);}}; $('#modal').classList.remove('hidden'); }
function closeModal(){ $('#modal').classList.add('hidden'); }
function opts(items,value='id',label='name'){return `<option value="">—</option>`+items.map(x=>`<option value="${escapeHtml(x[value])}">${escapeHtml(x[label])}</option>`).join('');}

function companyModal(){ openModal('Add Company',`<label>Company Name<input name="name" required></label><label>Code<input name="code"></label><label>Color<input name="color" type="color" value="#1677ff"></label><label class="full">Description<textarea name="description"></textarea></label><div class="modal-actions"><button type="button" class="btn secondary" onclick="document.querySelector('#modalClose').click()">Cancel</button><button class="btn primary">Create Company</button></div>`,f=>api('/api/companies',{method:'POST',body:Object.fromEntries(f)})); }
async function siteModal(){ if(!state.companies.length) await loadCompanies(); openModal('Add Site / Branch',`<label>Company<select name="companyId" required>${opts(state.companies)}</select></label><label>Site Name<input name="name" required></label><label>Code<input name="code"></label><label>Address<input name="address"></label><label class="full">Description<textarea name="description"></textarea></label><div class="modal-actions"><button type="button" class="btn secondary" onclick="document.querySelector('#modalClose').click()">Cancel</button><button class="btn primary">Create Site</button></div>`,f=>api('/api/sites',{method:'POST',body:Object.fromEntries(f)})); }
async function personModal(){ if(!state.companies.length) await loadCompanies(); openModal('Add Personnel',`<label>Employee Code<input name="employeeCode" required></label><label>Full Name<input name="fullName" required></label><label>Phone<input name="phone"></label><label>Department<input name="department"></label><label>Company<select name="companyId">${opts(state.companies)}</select></label><label>Site<select name="siteId">${opts(state.sites)}</select></label><label class="full">Notes<textarea name="notes"></textarea></label><div class="modal-actions"><button type="button" class="btn secondary" onclick="document.querySelector('#modalClose').click()">Cancel</button><button class="btn primary">Add Personnel</button></div>`,f=>api('/api/personnel',{method:'POST',body:Object.fromEntries(f)})); }
async function deviceModal(){ if(!state.companies.length) await loadCompanies(); openModal('Add Device',`<label>Name<input name="name" required></label><label>Management IP<input name="managementIp"></label><label>MAC Address<input name="mac"></label><label>Device Type<input name="deviceType" placeholder="Switch, Server, AP..."></label><label>Vendor<input name="vendor"></label><label>Model<input name="model"></label><label>Serial<input name="serial"></label><label>OS / IOS Version<input name="osVersion"></label><label>Company<select name="companyId">${opts(state.companies)}</select></label><label>Site<select name="siteId">${opts(state.sites)}</select></label><label>Asset Tag<input name="assetTag"></label><label>Location<input name="location"></label><label>Owner / Department<input name="ownerText"></label><label>Status<select name="status"><option value="active">Active</option><option value="inactive">Inactive</option><option value="maintenance">Maintenance</option></select></label><label class="full">Notes<textarea name="notes"></textarea></label><div class="modal-actions"><button type="button" class="btn secondary" onclick="document.querySelector('#modalClose').click()">Cancel</button><button class="btn primary">Add Device</button></div>`,f=>api('/api/devices',{method:'POST',body:Object.fromEntries(f)})); }

async function renderSettings(tab){
  $$('#settingsNav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab)); const body=$('#settingsBody');
  if(tab==='general'){ body.innerHTML=`<h2>General</h2><p>Core identity, localization and common defaults.</p>${settingRow('Application Name','Displayed across the EMS platform','<input class="field" value="EMS_IPAM">')}${settingRow('Timezone','Used for server-side scheduling','<select class="field"><option>Asia/Tehran</option></select>')}${settingRow('Display Calendar','Timestamps are stored in UTC; UI may render Persian dates','<select class="field"><option>Persian (Jalali)</option><option>Gregorian</option></select>')}`; return; }
  if(tab==='modules'){ body.innerHTML=`<h2>Modules</h2><p>New capabilities can be added without rebuilding the database design.</p><div class="module-settings-list">${['IPAM','Radio','RADIUS / AAA','Network Map','MAC Finder','Network Access / MAB','Future modules'].map((x,i)=>`<div class="module-setting"><div class="module-icon">◇</div><div><strong>${x}</strong><small>${i===6?'The Core accepts additional modules through the same contract.':'Separate installable module'}</small></div><div class="switch ${state.modules.some(m=>m.name===x)?'on':''}"></div></div>`).join('')}</div>`; return; }
  if(tab==='users'){ try{const r=await api('/api/users'); body.innerHTML=`<h2>Panel Users & Roles</h2><p>Admin, Support, Helpdesk and Viewer roles.</p>${table(['Username','Display Name','Role','Status'],r.items.map(x=>[escapeHtml(x.username),escapeHtml(x.display_name||'-'),escapeHtml(roleLabel(x.role)),`<span class="chip ${x.active?'green':'gray'}">${x.active?'Active':'Disabled'}</span>`]))}`;}catch{body.innerHTML='<h2>Panel Users & Roles</h2><p>Admin access is required.</p>';} return; }
  if(tab==='backup'){ let r={items:[]};try{r=await api('/api/backups')}catch{} body.innerHTML=`<div style="display:flex;justify-content:space-between"><div><h2>Backup & Restore</h2><p>Manual and scheduled backups. Application state remains outside /opt/ems-ipam.</p></div><button class="btn primary" data-action="backup">Backup Now</button></div>${settingRow('Automatic Backup','Default schedule: daily at 02:00','<div><span class="chip green">Enabled</span> &nbsp; Retention: 30 days</div>')}<h3 style="font-size:12px;margin-top:22px">Recent backups</h3>${table(['File','Type','Size','Created'],r.items.map(x=>[escapeHtml(x.filename),escapeHtml(x.backup_type),formatBytes(x.size_bytes),fmtDate(x.created_at)]))}`; return; }
  if(tab==='appearance'){ body.innerHTML=`<h2>Appearance</h2><p>The Stage 1 theme follows the approved EMS_IPAM visual direction.</p>${settingRow('Theme','Light workspace with dark navigation','<select class="field"><option>Light + Dark Sidebar</option><option>Dark</option></select>')}${settingRow('Density','Table and form spacing','<select class="field"><option>Comfortable</option><option>Compact</option></select>')}`; return; }
  body.innerHTML=`<h2>System</h2><p>Runtime and health information.</p>${settingRow('Core Version','Current base platform','<span class="chip green">1.0.0-stage1</span>')}${settingRow('Database','PostgreSQL 16','<span class="chip green">Connected</span>')}${settingRow('Module Isolation','A broken optional module must not stop Core startup.','<span class="chip green">Enabled</span>')}`;
}
function settingRow(title,desc,control){return `<div class="setting-row"><label>${title}<small>${desc}</small></label><div>${control}</div></div>`;}
async function createBackup(){ try{toast('Creating backup...');await api('/api/backups',{method:'POST'});toast('Backup created');if(state.page==='settings')renderSettings('backup');}catch(e){toast(e.message);} }
function formatBytes(n){n=Number(n||0);if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(1)+' MB';}

function bindGlobalSearch(){
  const input=$('#globalSearch'), box=$('#searchResults'); const run=debounce(async()=>{const q=input.value.trim();if(!q){box.classList.add('hidden');return;}try{const r=await api('/api/search?q='+encodeURIComponent(q));state.searchItems=r.items||[];state.searchIndex=-1;box.innerHTML=state.searchItems.length?state.searchItems.map((x,i)=>`<div class="search-item" data-i="${i}"><span class="kind">${x.type==='device'?'▣':x.type==='personnel'?'♙':'▦'}</span><div><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.subtitle||'')}</small></div><em>${escapeHtml(x.type)}</em></div>`).join(''):'<div class="search-item"><div></div><div><b>No matching results</b></div></div>';box.classList.remove('hidden');}catch{}},160);
  input.addEventListener('input',run);
  input.addEventListener('keydown',e=>{if(box.classList.contains('hidden'))return;if(e.key==='ArrowDown'){e.preventDefault();state.searchIndex=Math.min(state.searchItems.length-1,state.searchIndex+1);mark();}if(e.key==='ArrowUp'){e.preventDefault();state.searchIndex=Math.max(0,state.searchIndex-1);mark();}if(e.key==='Enter'&&state.searchIndex>=0){e.preventDefault();selectSearch(state.searchItems[state.searchIndex]);}});
  box.addEventListener('click',e=>{const el=e.target.closest('[data-i]');if(el)selectSearch(state.searchItems[Number(el.dataset.i)]);});
  document.addEventListener('click',e=>{if(!e.target.closest('.global-search-wrap'))box.classList.add('hidden')});
  function mark(){ $$('.search-item').forEach((x,i)=>x.classList.toggle('selected',i===state.searchIndex)); }
  function selectSearch(item){ box.classList.add('hidden'); input.value=item.title; if(item.type==='device'){go('inventory');$('#deviceFilter').value=item.title;loadDevices();}else if(item.type==='personnel'){go('personnel');$('#personFilter').value=item.title;loadPersonnel();}else go('companies'); }
}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

init();
