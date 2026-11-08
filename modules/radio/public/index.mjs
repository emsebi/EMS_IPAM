import { renderRadioTopology, radioUplinkSaved, radioConnectionHint } from './topology.mjs?v=2.3.0-lab.1';
import { createGeoUi } from './geo-ui.mjs?v=2.3.0-lab.1';

export function createUi(ctx) {
const { state, $, page, isModuleInstalled, hasClientModule, ensureInventory, updateSelectors, navActive, setRoute, toast, canWrite, ipv4ToInt, intToIpv4, request, prepareHostEditor, loadSpace, escapeHtml, formatNumber, formatDateTime, translateTree, t, openToolMenu } = ctx;
const geo = createGeoUi({request,escapeHtml,canWrite,toast,state,onOpenAp:(id)=>{
  state.selectedRadioApId=id;state.radioStationPage=0;renderRadios();
}});
const uplinkCache = new Map();
const loadingUplinks = new Set();
function getRadioLink(apId) {
  if (!apId || uplinkCache.has(apId) || loadingUplinks.has(apId)) return;
  loadingUplinks.add(apId);
  request('/api/radio/uplink?apId='+encodeURIComponent(apId))
    .then((result) => { uplinkCache.set(apId,result.link||null); if(state.view==='radios') renderRadios(); })
    .catch((error) => { if(state.view==='radios') toast(error.message); })
    .finally(() => loadingUplinks.delete(apId));
}
async function openRadiosPage(force = true, { fromRoute = false } = {}) {
  if (!isModuleInstalled("radio") || !hasClientModule("radio")) {
    toast(t("radio.error.moduleUnavailable"));
    return;
  }
  try {
    await ensureInventory(force);
    state.view = "radios";
    state.currentSpaceId = null;
    state.data = null;
    updateSelectors();
    navActive("radios");
    if (!fromRoute) setRoute("/radios");
    renderRadios();
  } catch (error) { toast(error.message); }
}

async function quickOpenRadio(ip, mode, parentId = "") {
  if (!canWrite()) return toast(t("radio.error.adminOnly"));
  const value = String(ip || "").trim();
  if (ipv4ToInt(value) === null) return toast(t("radio.error.validIpRequired"));
  if (!['ap', 'station'].includes(mode)) return toast(t("radio.error.modeRequired"));
  if (mode === "station" && !parentId) return toast(t("radio.error.parentApRequired"));
  try {
    const result = await request(`/api/search?q=${encodeURIComponent(value)}`);
    const item = (result.items || []).find((entry) => entry.ip === value);
    if (!item) return toast(t("radio.error.ipOutOfScope"));
    const parent = state.inventory.find((entry) => entry.id === parentId);
    await prepareHostEditor(item.spaceId, value, "radios", {
      radioMode: mode,
      radioParentHostId: mode === "station" ? parentId : null,
      ...(mode === "station" && parent?.ssid ? { ssid: parent.ssid } : {}),
      type: "Radio",
    });
    $("hostName").focus();
  } catch (error) { toast(error.message); }
}

function radioMatches(item, query) {
  return !query || [item.name,item.ip,item.mac,item.ssid,item.companyName,item.spaceName,item.location].some((value)=>String(value||"").toLowerCase().includes(query));
}

function radioStatus(item) {
  if (item.pingOnline === true) return { className: "online", label: t("radio.status.online") };
  if (item.pingOnline === false) return { className: "offline", label: t("radio.status.offline") };
  return { className: "unknown", label: t("radio.status.unknown") };
}

function radioStatusBadge(item) {
  const status = radioStatus(item);
  const title = item.pingCheckedAt ? t("radio.status.lastChecked", { time: formatDateTime(item.pingCheckedAt) }) : t("radio.status.notPinged");
  return `<span class="radio-status ${status.className}" title="${escapeHtml(title)}"><i></i>${status.label}</span>`;
}

async function openRadioEditor(item) {
  if (!item) return;
  await prepareHostEditor(item.spaceId, item.ip, "radios");
}

async function openRadioInIpam(item) {
  if (!item) return;
  const address = ipv4ToInt(item.ip);
  await loadSpace(item.spaceId, { sheetCidr: `${intToIpv4(address & 0xffffff00)}/24` });
}

async function pingRadio(item, button) {
  if (!item) return;
  const original = button?.textContent || t("radio.action.ping");
  if (button) { button.disabled = true; button.textContent = "…"; }
  try {
    const result = await request("/api/ping/host", { method: "POST", body: { id: item.id } });
    await ensureInventory(true);
    renderRadios();
    toast(result.online ? t("radio.toast.online", { ip: item.ip }) : t("radio.toast.noReply", { ip: item.ip }));
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = original; }
    toast(error.message);
  }
}

function renderRadios() {
  const radios = state.inventory.filter((item) => (!state.currentCompanyId || item.companyId === state.currentCompanyId) && ['ap','station'].includes(item.radioMode));
  const q = (state.radioQuery || '').trim().toLowerCase();
  const allAps = radios.filter((item) => item.radioMode === 'ap');
  const allStations = radios.filter((item) => item.radioMode === 'station');
  const aps = allAps.filter((ap) => radioMatches(ap,q) || allStations.some((st) => st.radioParentHostId === ap.id && radioMatches(st,q)));
  const orphans = allStations.filter((st) => !allAps.some((ap) => ap.id === st.radioParentHostId) && radioMatches(st,q));
  if (!aps.some((ap) => ap.id === state.selectedRadioApId) && !(state.selectedRadioApId === '__orphans' && orphans.length)) state.selectedRadioApId = aps[0]?.id || (orphans.length ? '__orphans' : '');
  const selected = aps.find((ap) => ap.id === state.selectedRadioApId);
  const stations = selected ? allStations.filter((st) => st.radioParentHostId === selected.id && (radioMatches(selected,q) || radioMatches(st,q))) : (state.selectedRadioApId === '__orphans' ? orphans : []);
  const lastPage = Math.max(0,Math.ceil(stations.length / 25)-1);
  state.radioStationPage = Math.min(state.radioStationPage || 0,lastPage);
  const displayed = stations.slice(state.radioStationPage*25,(state.radioStationPage+1)*25);
  const topology = renderRadioTopology({
    ap:selected,stations,inventory:state.inventory,link:selected?uplinkCache.get(selected.id):null,
    canEdit:canWrite(),compact:true,escapeHtml,language:document.documentElement.lang||'en'
  });
  if(selected) getRadioLink(selected.id);
  const geographicMap = geo.content({ap:selected,stations,aps,allStations});
  const actions = (item) => `<div class="row-actions"><button type="button" class="btn sm radio-connect" data-id="${escapeHtml(item.id)}">Connect</button><button class="btn sm open-ipam-radio" data-id="${escapeHtml(item.id)}">${escapeHtml(t("radio.action.ipam"))}</button><button class="btn sm ping-radio" data-id="${escapeHtml(item.id)}">${escapeHtml(t("radio.action.ping"))}</button>${canWrite()?`<button class="btn sm edit-radio" data-id="${escapeHtml(item.id)}">${escapeHtml(t("radio.action.edit"))}</button>`:''}</div>`;
  page.innerHTML = `<div class="headline"><div><div class="crumb">${escapeHtml(t("radio.breadcrumb"))}</div><h2>${escapeHtml(t("radio.title"))}</h2><div class="subtitle">${escapeHtml(t("radio.subtitle"))}</div></div><button id="radioReload" class="btn">${escapeHtml(t("radio.action.refresh"))}</button></div>
    <section class="stats"><article class="stat"><div class="label">${escapeHtml(t("radio.label.accessPoint"))}</div><div class="value">${formatNumber(allAps.length)}</div></article><article class="stat"><div class="label">${escapeHtml(t("radio.label.station"))}</div><div class="value">${formatNumber(allStations.length)}</div></article><article class="stat"><div class="label">${escapeHtml(t("radio.stats.selectedStations"))}</div><div class="value">${formatNumber(stations.length)}</div></article></section>
    <section class="panel radio-register-panel"><div class="radio-register-form"><input id="radioSearch" value="${escapeHtml(state.radioQuery||'')}" placeholder="${escapeHtml(t("radio.search.placeholder"))}">
    ${canWrite()?`<input id="radioQuickIp" class="ltr mono" placeholder="192.0.2.10"><select id="radioQuickMode"><option value="ap">${escapeHtml(t("radio.label.accessPoint"))}</option><option value="station">${escapeHtml(t("radio.label.station"))}</option></select><select id="radioQuickParent" class="hidden"><option value="">${escapeHtml(t("radio.selectAp"))}</option>${allAps.map((ap)=>`<option value="${escapeHtml(ap.id)}">${escapeHtml(ap.name||ap.ip)}</option>`).join('')}</select><button id="radioQuickOpen" class="btn primary">${escapeHtml(t("radio.action.register"))}</button>`:''}</div></section>
    ${geographicMap}
    <section class="radio-master-detail"><aside class="panel radio-ap-list" aria-label="${escapeHtml(t("radio.label.accessPoint"))}">${aps.map((ap)=>`<button type="button" class="radio-ap-choice ${ap.id===selected?.id?'selected':''}" data-id="${escapeHtml(ap.id)}" aria-pressed="${ap.id===selected?.id}"><strong>${escapeHtml(ap.name||ap.ip)}</strong><span class="ltr mono">${escapeHtml(ap.ip)}</span><small>${escapeHtml(ap.ssid||'—')} · ${formatNumber(allStations.filter(st=>st.radioParentHostId===ap.id).length)} ${escapeHtml(t("radio.label.station"))}</small>${radioStatusBadge(ap)}</button>`).join('')}${orphans.length?`<button type="button" class="radio-ap-choice ${state.selectedRadioApId==='__orphans'?'selected':''}" data-id="__orphans"><strong>${escapeHtml(t("radio.orphans"))}</strong><small>${formatNumber(orphans.length)}</small></button>`:''}${!aps.length&&!orphans.length?'<div class="empty-state">${escapeHtml(t("radio.empty.noMatching"))}</div>':''}</aside>
    <article class="panel radio-detail"><div class="radio-unified-head"><h3>Radio Topology & Stations</h3><small>AP → registered Stations · Inventory documentation</small></div>${topology}<div class="radio-detail-head"><div><h3>${escapeHtml(selected?.name||selected?.ip||(orphans.length?t("radio.orphans"):t("radio.selectAp")))}</h3>${selected?`<p class="ltr mono">${escapeHtml(selected.ip)} · ${escapeHtml(selected.ssid||'—')}</p>${radioStatusBadge(selected)}`:''}</div>${selected?`<div>${actions(selected)}${canWrite()?`<button class="btn primary sm" id="addSelectedStation">${escapeHtml(t("radio.action.addStation"))}</button>`:''}</div>`:''}</div>
    <div class="radio-station-list">${displayed.map((st)=>`<article class="radio-station-row"><div><button class="link-btn open-radio-host" data-id="${escapeHtml(st.id)}"><b>${escapeHtml(st.name||st.ip)}</b></button><div class="ltr mono">${escapeHtml(st.ip)}</div><small>${escapeHtml(st.mac||'—')} · ${escapeHtml(st.ssid||'—')}</small></div>${radioStatusBadge(st)}${actions(st)}</article>`).join('')||`<div class="empty-state">${escapeHtml(t("radio.empty.noStations"))}</div>`}</div>
    <div class="row-actions pagination"><button id="radioPrevious" class="btn sm" ${state.radioStationPage===0?'disabled':''}>${escapeHtml(t("radio.pagination.previous"))}</button><span>${formatNumber(state.radioStationPage+1)} / ${formatNumber(lastPage+1)}</span><button id="radioNext" class="btn sm" ${state.radioStationPage>=lastPage?'disabled':''}>${escapeHtml(t("radio.pagination.next"))}</button></div></article></section>`;
  const syncMode = () => $('radioQuickParent')?.classList.toggle('hidden',$('radioQuickMode')?.value !== 'station');
  $('radioQuickMode')?.addEventListener('change',syncMode);
  $('radioQuickOpen')?.addEventListener('click',()=>quickOpenRadio($('radioQuickIp').value,$('radioQuickMode').value,$('radioQuickParent').value));
  $('radioSearch').addEventListener('input',(event)=>{state.radioQuery=event.target.value;state.radioStationPage=0;renderRadios();$('radioSearch').focus();$('radioSearch').setSelectionRange(state.radioQuery.length,state.radioQuery.length);});
  $('radioReload').addEventListener('click',()=>openRadiosPage(true));
  page.querySelectorAll('.radio-ap-choice').forEach((button)=>button.addEventListener('click',()=>{
    if(button.dataset.id!=='__orphans')geo.openAp(button.dataset.id);
    state.selectedRadioApId=button.dataset.id;state.radioStationPage=0;renderRadios();
  }));
  $('addSelectedStation')?.addEventListener('click',()=>{$('radioQuickMode').value='station';$('radioQuickParent').value=selected.id;syncMode();$('radioQuickIp').focus();});
  $('radioPrevious').addEventListener('click',()=>{state.radioStationPage--;renderRadios();});
  $('radioNext').addEventListener('click',()=>{state.radioStationPage++;renderRadios();});
  page.querySelectorAll('.open-radio-host,.edit-radio').forEach((node)=>node.addEventListener('click',()=>openRadioEditor(state.inventory.find((item)=>item.id===node.dataset.id)).catch((error)=>toast(error.message))));
  page.querySelectorAll('.open-ipam-radio').forEach((node)=>node.addEventListener('click',()=>openRadioInIpam(state.inventory.find((item)=>item.id===node.dataset.id))));
  page.querySelectorAll('.ping-radio').forEach((node)=>node.addEventListener('click',()=>pingRadio(state.inventory.find((item)=>item.id===node.dataset.id),node)));
  page.querySelectorAll('.radio-connect').forEach(button=>button.addEventListener('click',(event)=>{
    const device=state.inventory.find(item=>item.id===button.dataset.id);
    if(!device)return;
    const connections=Array.isArray(device.connectionMethods)?device.connectionMethods:[];
    if(!connections.length)return toast(radioConnectionHint(document.documentElement.lang));
    const box=button.getBoundingClientRect();
    openToolMenu({clientX:box.left,clientY:box.bottom,stopPropagation(){}},device.ip,connections,{username:device.username||''});
  }));

  $('radioDocSave')?.addEventListener('click',async()=>{
    if(!selected || !canWrite()) return;
    const button=$('radioDocSave');button.disabled=true;
    try {
      const result=await request('/api/radio/uplink',{method:'PUT',body:{
        apId:selected.id,destinationId:$('radioDocDestination').value,port:$('radioDocPort').value.trim()
      }});
      uplinkCache.set(selected.id,result.link||null);
      renderRadios();
      toast(radioUplinkSaved(document.documentElement.lang));
    } catch(error) { button.disabled=false; toast(error.message); }
  });
  geo.attach({ap:selected,stations,aps,allStations});
  syncMode(); translateTree(page);
}
return { openRadiosPage, renderRadios };
}
