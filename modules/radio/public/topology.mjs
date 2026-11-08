// Offline manufacturer hints for the radio documentation view.
// OUI means MAC block registrant, not proven product identity. Inventory vendor overrides it.
export const OUI_PREFIXES = Object.freeze({
  MikroTik: "000C42 04F41C 085531 18FD74 2CC81B 38327A 488F5A 48A98A 4C5E0C 64D154 6C3B6B 744D28 789A18 B869F4 C4AD34 CC2DE0 D0EA11 D401C3 D4CA6D DC2C6E E48D8C F41E57",
  Ubiquiti: "00156D 002722 0418D6 0CEA14 18E829 1C0B8B 1C6A1B 245A4C 24A43C 28704E 2CE5BD 44D9E7 58D61F 602232 682E3C 687251 68D79A 6C63F8 70A741 7483C2 74ACB9 74F92C 74FA29 784558 788A20 802AA8 847848 8C3066 8CEDE1 9041B2 942A6F 9C05D6 A4F8FF A89C6C AC8BA9 B4FBE4 CC35D9 D021F9 D489C1 D8B370 D8C262 DC9FDB E063DA E43883 F09FC2 F492BF F4E2C6 FCECDA",
  "TP-Link": "EC086B"
});
const lookup = new Map(Object.entries(OUI_PREFIXES).flatMap(([name,prefixes]) => prefixes.split(" ").map(prefix => [prefix,name])));
export function vendorForMac(mac, recorded = "") {
  if (String(recorded || "").trim()) return {name:String(recorded).trim(),source:"inventory"};
  const raw=String(mac||"").replace(/[^a-fA-F0-9]/g,"").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(raw)) return {name:"",source:"unknown"};
  if ((parseInt(raw.slice(0,2),16)&2)!==0) return {name:"",source:"locally-administered"};
  return {name:lookup.get(raw.slice(0,6))||"",source:lookup.has(raw.slice(0,6))?"oui":"unknown"};
}
export function renderRadioTopology({ap,stations=[],inventory=[],link=null,canEdit=false,compact=false,escapeHtml,language="en"}) {
  const esc=(v)=>escapeHtml(String(v??""));
  const fa=String(language).toLowerCase().startsWith("fa");
  const tr=(en,persian)=>fa?persian:en;
  const cell=(label,value)=>`<div class="radio-doc-meta"><span>${esc(label)}</span><strong>${esc(value||"—")}</strong></div>`;
  if (!ap) return `<section class="radio-doc-empty">${esc(tr("Select an access point to display its documented connections.","برای نمایش اتصالات ثبت‌شده یک اکسس‌پوینت انتخاب کنید."))}</section>`;
  const peers=inventory.filter(x=>x.companyId===ap.companyId && x.id!==ap.id && !["ap","station"].includes(x.radioMode));
  const uplink=peers.find(x=>x.id===link?.destinationId);
  const brand=(host)=>{const result=vendorForMac(host.mac,host.vendor);return result.name || tr("Unknown manufacturer","سازنده نامشخص");};
  const short=(host)=>host.name||host.ip||tr("Unnamed device","دستگاه بدون نام");
  const lastPing=(host)=>host.pingCheckedAt ? " · "+String(host.pingCheckedAt).slice(0,19).replace("T"," ") : "";
  const ping=(host)=>host.pingOnline===true?tr("Ping reachable","پینگ موفق"):host.pingOnline===false?tr("No ping reply","بدون پاسخ پینگ"):tr("Ping not checked","پینگ بررسی نشده");
  const connection=(host)=>Array.isArray(host.connectionMethods)&&host.connectionMethods.length
    ?host.connectionMethods.map(m=>String(m.type||"").toUpperCase()+":"+String(m.port||"default")).join(" · ")
    :tr("Configure connection in Inventory","اتصال را در Inventory ثبت کنید");
  const controls=(host)=>`<div class="radio-doc-actions"><button type="button" class="btn sm radio-connect" data-id="${esc(host.id)}">${esc(tr("Connect","اتصال"))}</button><button type="button" class="btn sm ping-radio" data-id="${esc(host.id)}">${esc(tr("Ping","پینگ"))}</button></div>`;

  if (compact) {
    // Use one compact topology summary inside the AP/Station master-detail panel.
    // This replaces the former duplicate Station cards and overview table.
    return `<section class="radio-doc-compact" aria-label="${esc(tr("Radio Topology","نقشه اتصالات رادیو"))}">
      <div class="radio-doc-compact-head"><strong>${esc(tr("Radio Topology","نقشه اتصالات رادیو"))}</strong><small>${esc(tr("Documented connections only","فقط ارتباطات ثبت‌شده"))}</small></div>
      <div class="radio-doc-compact-chain">
        <div class="radio-doc-compact-node"><small>${esc(tr("Switch / System","سوئیچ / سیستم"))}</small>
          <strong>${esc(uplink?short(uplink):tr("Not documented","ثبت نشده"))}</strong>
          <span class="mono ltr">${esc(uplink?.ip||"—")}</span>
          <span>${esc(link?.port||"—")}</span></div>
        <span class="radio-doc-arrow" aria-hidden="true">→</span>
        <div class="radio-doc-compact-node radio-doc-compact-ap"><small>AP · ${esc(brand(ap))}</small>
          <strong>${esc(short(ap))}</strong><span class="mono ltr">${esc(ap.ip||"—")}</span>
          <span>${esc(ap.model||"—")} · ${esc(ap.location||"—")}</span>
          <span>${esc(ping(ap)+lastPing(ap))}</span>${controls(ap)}</div>
        <span class="radio-doc-arrow" aria-hidden="true">→</span>
        <div class="radio-doc-compact-node"><small>${esc(tr("Stations","استیشن‌ها"))}</small><strong>${esc(stations.length)}</strong>
          <span>${esc(tr("Listed below","در فهرست زیر"))}</span></div>
      </div>
      <div class="radio-doc-edit"><h4>${esc(tr("Uplink destination","مقصد اتصال AP"))}</h4>
      ${canEdit?`<div class="radio-doc-controls"><label>${esc(tr("Switch / System","سوئیچ / سیستم"))}<select id="radioDocDestination"><option value="">${esc(tr("Not specified","ثبت نشده"))}</option>${peers.map(x=>`<option value="${esc(x.id)}" ${x.id===link?.destinationId?"selected":""}>${esc(short(x))} · ${esc(x.ip)}</option>`).join("")}</select></label>
        <label>${esc(tr("Port / Interface","پورت اتصال"))}<input id="radioDocPort" maxlength="64" value="${esc(link?.port||"")}" placeholder="ether1 / Gi1/0/24"></label>
        <button type="button" class="btn primary sm" id="radioDocSave">${esc(tr("Save link","ذخیره اتصال"))}</button></div>`:
        `<p>${esc(tr("Read-only uplink information","مقصد اتصال فقط خواندنی است"))}</p>`}
      </div>
    </section>`;
  }
  const vendors=stations.filter(x=>vendorForMac(x.mac,x.vendor).name).length;
  const locations=new Set(stations.map(x=>String(x.location||"").trim()).filter(Boolean)).size;
  const cards=stations.map((st)=>`<article class="radio-doc-node radio-doc-station">
    <div class="radio-doc-node-title"><span class="radio-doc-icon">◉</span><div><button type="button" class="radio-doc-node-link open-radio-host" data-id="${esc(st.id)}">${esc(short(st))}</button><small>${esc(brand(st))}</small></div></div>
    ${cell("IP",st.ip)}${cell(tr("Model","مدل"),st.model)}${cell(tr("Location","موقعیت"),st.location)}${cell("MAC",st.mac)}
    ${cell(tr("Status","وضعیت"),ping(st)+lastPing(st))}${cell(tr("Connection","روش اتصال"),connection(st))}${controls(st)}
  </article>`).join("");
  return `<section class="radio-doc-grid" aria-label="${esc(tr("Radio documentation map","نقشه مستندسازی رادیو"))}">
   <div class="radio-doc-main">
    <div class="radio-doc-heading"><div><h3>${esc(tr("Radio Topology","نقشه اتصالات رادیو"))}</h3><small>${esc(tr("Documented links · no automatic polling","اتصالات مستندشده · بدون پایش خودکار"))}</small></div><span class="radio-doc-chip">${esc(tr("Documentation","مستندسازی"))}</span></div>
    <div class="radio-doc-canvas">
     <div class="radio-doc-stage radio-doc-upstage">
       ${uplink?`<article class="radio-doc-node radio-doc-uplink"><div class="radio-doc-node-title"><span class="radio-doc-icon">▤</span><div><strong>${esc(short(uplink))}</strong><small>${esc(uplink.type||tr("Switch / System","سوئیچ / سیستم"))}</small></div></div>${cell("IP",uplink.ip)}${cell(tr("Port","پورت"),link.port)}</article>`:
       `<article class="radio-doc-node radio-doc-uplink radio-doc-unset"><div class="radio-doc-node-title"><span class="radio-doc-icon">▤</span><div><strong>${esc(tr("Switch / System","سوئیچ / سیستم"))}</strong><small>${esc(tr("Uplink not documented","مقصد اتصال ثبت نشده"))}</small></div></div></article>`}
     </div>
     <div class="radio-doc-line" aria-hidden="true"></div>
     <div class="radio-doc-stage"><article class="radio-doc-node radio-doc-ap">
       <div class="radio-doc-node-title"><span class="radio-doc-icon">◎</span><div><strong>${esc(short(ap))}</strong><small>${esc(tr("Access Point","اکسس پوینت"))}</small></div></div>
       ${cell("IP",ap.ip)}${cell("SSID",ap.ssid)}${cell(tr("Model","مدل"),ap.model)}${cell("MAC",ap.mac)}${cell(tr("Location","موقعیت"),ap.location)}${cell(tr("Stations","استیشن‌ها"),stations.length)}
       ${cell(tr("Status","وضعیت"),ping(ap)+lastPing(ap))}${cell(tr("Connection","روش اتصال"),connection(ap))}${controls(ap)}
      </article></div>
     ${stations.length?`<div class="radio-doc-line" aria-hidden="true"></div><div class="radio-doc-stations">${cards}</div>`:`<div class="radio-doc-empty">${esc(tr("No stations documented for this AP.","هنوز استیشنی برای این AP ثبت نشده است."))}</div>`}
    </div>
    <div class="radio-doc-edit"><h4>${esc(tr("Uplink destination","مقصد اتصال AP"))}</h4>
     ${canEdit?`<div class="radio-doc-controls"><label>${esc(tr("Switch / System","سوئیچ / سیستم"))}<select id="radioDocDestination"><option value="">${esc(tr("Not specified","ثبت نشده"))}</option>${peers.map(x=>`<option value="${esc(x.id)}" ${x.id===link?.destinationId?"selected":""}>${esc(short(x))} · ${esc(x.ip)}</option>`).join("")}</select></label>
       <label>${esc(tr("Port / Interface","پورت اتصال"))}<input id="radioDocPort" maxlength="64" value="${esc(link?.port||"")}" placeholder="ether1 / Gi1/0/24"></label>
       <button type="button" class="btn primary sm" id="radioDocSave">${esc(tr("Save link","ذخیره اتصال"))}</button></div>`:`<p>${esc(tr("Read-only. Administrators can link this AP to an inventory device.","فقط نمایش؛ مدیر می‌تواند AP را به دستگاهی از موجودی متصل کند."))}</p>`}
     <small>${esc(tr("Choose an existing Inventory device. No router login or configuration change.","دستگاه مقصد را از Inventory انتخاب کنید؛ بدون ورود به رادیو یا تغییر تنظیمات."))}</small>
    </div>
   </div>
   <aside class="radio-doc-side"><h3>${esc(tr("Radio Overview","خلاصه رادیو"))}</h3>
     <div class="radio-doc-metrics"><div><small>${esc(tr("Connected stations","استیشن‌های ثبت‌شده"))}</small><strong>${esc(stations.length)}</strong></div><div><small>${esc(tr("Locations","موقعیت‌ها"))}</small><strong>${esc(locations)}</strong></div><div><small>${esc(tr("Known manufacturers","سازندگان شناسایی‌شده"))}</small><strong>${esc(vendors)}</strong></div><div><small>${esc(tr("Uplink","مقصد اتصال"))}</small><strong>${uplink?"✓":"—"}</strong></div></div>
     <h4>${esc(tr("Connected Stations","استیشن‌های متصل"))}</h4>
     <div class="radio-doc-table-wrap"><table class="radio-doc-table"><thead><tr><th>${esc(tr("Name","نام"))}</th><th>IP</th><th>${esc(tr("Vendor","سازنده"))}</th><th>${esc(tr("Model","مدل"))}</th><th>${esc(tr("Location","موقعیت"))}</th></tr></thead><tbody>
     ${stations.map(st=>`<tr><td>${esc(short(st))}</td><td class="ltr mono">${esc(st.ip)}</td><td>${esc(brand(st))}</td><td>${esc(st.model||"—")}</td><td>${esc(st.location||"—")}</td></tr>`).join("")||`<tr><td colspan="5">${esc(tr("No documented stations","استیشنی ثبت نشده"))}</td></tr>`}</tbody></table></div>
     <small class="radio-doc-hint">${esc(tr("Manufacturer is taken from Inventory or a limited offline OUI list; MAC identification is not guaranteed.","سازنده از Inventory یا فهرست محدود OUI آفلاین تشخیص داده می‌شود؛ شناسایی قطعی نیست."))}</small>
   </aside>
  </section>`;
}

export function radioUplinkSaved(language = 'en') { return String(language).toLowerCase().startsWith('fa') ? 'اتصال ذخیره شد.' : 'Uplink saved.'; }

export function radioConnectionHint(language = 'en') { return String(language).toLowerCase().startsWith('fa') ? 'روش اتصال را در Inventory دستگاه ثبت کنید.' : 'Set a connection method in Inventory first.'; }
