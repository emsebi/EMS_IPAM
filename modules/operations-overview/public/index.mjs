import { scopedInventory, radioGroups, distanceKm, recordedStatus, snapshotStatus, validTopology } from "./model.mjs";

// Live database-backed overview. This module never scans devices or changes settings.
export function createUi(ctx) {
  const { state, page, request, toast } = ctx;
  const L = (en, fa) => state.language === "fa" ? fa : en;
  let tab = "ipam", companyId = state.currentCompanyId || "", siteId = "", apId = "", nodeId = "";
  let inventory = [], details = null, radius = null, network = null, error = "", query = "", run = 0;
  let radiusError = "", networkError = "", siteError = "";
  const companies = () => state.bootstrap?.companies || [];
  const spaces = () => state.bootstrap?.spaces || [];
  const modules = () => new Set((state.bootstrap?.modules || []).map(item => item.id));
  const txt = value => String(value ?? "");
  const display = value => txt(value).trim() || "—";
  const number = value => Number(value || 0).toLocaleString(state.language === "fa" ? "fa-IR" : "en-US");

  function E(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
      if (key === "text") e.textContent = txt(val);
      else if (key === "class") e.className = val;
      else if (key === "onClick") e.addEventListener("click", val);
      else if (key === "onChange") e.addEventListener("change", val);
      else if (key === "onInput") e.addEventListener("input", val);
      else if (key === "value") e.value = val;
      else if (val !== null && val !== undefined) e.setAttribute(key, txt(val));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      e.append(child instanceof Node ? child : document.createTextNode(txt(child)));
    }
    return e;
  }
  function action(label, fn, kind = "") {
    return E("button", {type:"button", class:"btn " + kind, text:label, onClick:fn});
  }
  function link(label, path) {
    return E("a", {class:"btn sm", href:"#" + path, text:label});
  }
  function panel(title, ...children) {
    return E("section", {class:"panel ov-panel"}, E("h3", {text:title}), ...children);
  }
  function note(value) { return E("p", {class:"ov-note", text:value}); }
  function stat(label, value) {
    return E("article", {class:"ov-stat"}, E("span", {text:label}), E("strong", {text:number(value)}));
  }
  function metricBar(items) { return E("div", {class:"ov-metrics"}, ...items.map(item => stat(item[0],item[1]))); }
  function table(headers, rows, empty) {
    const body = E("tbody");
    if (!rows.length) body.append(E("tr",{}, E("td",{colspan:headers.length, class:"ov-empty",text:empty})));
    else for (const cells of rows) {
      const tr = E("tr");
      for (const cell of cells) tr.append(E("td",{},cell instanceof Node ? cell : display(cell)));
      body.append(tr);
    }
    return E("div",{class:"ov-table-wrap"},E("table",{class:"ov-table"},
      E("thead",{}, E("tr",{}, ...headers.map(h => E("th",{text:h})))),body));
  }
  function selector(options, value, onChange) {
    const input = E("select",{class:"ov-select", onChange:e=>onChange(e.target.value)});
    for (const [id,label] of options) input.append(E("option",{value:id,text:label}));
    input.value = value;
    return input;
  }
  function statusPill(status, label) {
    return E("span",{class:"ov-status ov-" + status,text:label});
  }
  function pingPill(item) {
    const status = recordedStatus(item);
    return statusPill(status, status === "up" ? L("Last ping: up","آخرین پینگ: پاسخ") :
      status === "down" ? L("Last ping: down","آخرین پینگ: بدون پاسخ") :
      L("Not checked","بررسی نشده"));
  }
  function siteTitle(id) { return companies().find(x=>x.id===id)?.name || ""; }
  function companyControl(onChange) {
    return selector([["",L("All sites","همه شعب")], ...companies().map(c=>[c.id,c.name])],companyId,onChange);
  }
  function banner() {
    return E("div",{class:"ov-banner"}, E("strong",{text:L("Verified records only","فقط اطلاعات ثبت‌شده")}),
      E("span",{text:L("No generated samples, automatic scans, or invented online status. Counts are scoped to recorded inventory.","بدون اطلاعات نمونه، اسکن خودکار یا وضعیت آنلاین ساختگی؛ شمارش‌ها فقط بر اساس رکوردهای Inventory است.")}));
  }
  function header() {
    const heading=E("div",{},E("small",{text:"EMS_IPAM / Operations"}),E("h2",{text:L("Network operations overview","نمای عملیاتی شبکه")}),
      E("p",{class:"subtitle",text:L("IPAM, sites, radios, RADIUS and saved topology in one place.","نمای یکپارچه IPAM، شعب، رادیو، RADIUS و توپولوژی ذخیره‌شده.")}));
    return E("div",{class:"headline ov-header"},heading,action(L("Refresh records","بازخوانی اطلاعات"),()=>refresh(),"primary"));
  }
  function navigation() {
    const items=[["ipam",L("IP Manager & Inventory","IP Manager و تجهیزات")],
      ["sites",L("Sites / Branches","شعب و سایت‌ها")],["radio",L("Radio links","ارتباطات رادیویی")],
      ["radius",L("RADIUS groups","گروه‌بندی RADIUS")],["network",L("Saved network map","نقشه شبکه")]];
    return E("div",{class:"ov-tabs",role:"tablist"},...items.map(([id,label])=>
      E("button",{type:"button",role:"tab","aria-selected":tab===id?"true":"false",class:tab===id?"active":"",
        text:label,onClick:()=>{tab=id;render();loadSelected().catch(e=>toast(e.message));}})));
  }
  function render() {
    if (state.currentModuleId !== "operations-overview" || state.view !== "module") return;
    const root=E("div",{class:"ov-root"},header(),navigation(),banner());
    if (error) root.append(panel(L("Data error","خطای دریافت داده"),note(error)));
    else if (tab==="ipam") root.append(renderIpam());
    else if (tab==="sites") root.append(renderSites());
    else if (tab==="radio") root.append(renderRadio());
    else if (tab==="radius") root.append(renderRadius());
    else root.append(renderNetwork());
    page.replaceChildren(root);
  }
  function makeInventoryTable() {
    const matches=scopedInventory(inventory,companyId).filter(item=>
      !query || [item.name,item.ip,item.mac,item.vendor,item.model,item.type,item.companyName,item.spaceName]
        .some(v=>txt(v).toLowerCase().includes(query.toLowerCase())));
    const rows=matches.slice(0,80).map(item=>[
      E("strong",{text:display(item.name)}),E("code",{text:display(item.ip)}),
      display(item.companyName),display(item.spaceName),
      display([item.vendor,item.model,item.type].filter(Boolean).join(" / ")),
      link(L("Open device list","فهرست تجهیزات"),"/inventory")
    ]);
    return E("div",{},table([L("Device","تجهیز"),"IP",L("Site","شعبه"),L("Space","رنج"),L("Type / Model","نوع / مدل"),L("Action","عملیات")],
      rows,L("No matching registered devices","تجهیز ثبت‌شده‌ای مطابق فیلتر نیست")),
      matches.length>80?note(L("First 80 results; filter to narrow.","۸۰ رکورد اول؛ با فیلتر جست‌وجو محدود کنید.")) : null);
  }
  function renderIpam() {
    const filtered=scopedInventory(inventory,companyId);
    const siteSpaces=spaces().filter(s=>!companyId || s.companyId===companyId);
    const box=E("div",{class:"ov-stack"},E("div",{class:"ov-toolbar"},companyControl(id=>{companyId=id;render();})),
      metricBar([[L("Visible sites","سایت‌های قابل نمایش"),companyId?1:companies().length],
        [L("Address spaces","رنج‌های اصلی"),siteSpaces.length],
        [L("Registered devices","تجهیزات ثبت‌شده"),filtered.length],
        [L("APs / stations","AP / Station"),filtered.filter(x=>x.radioMode==="ap"||x.radioMode==="station").length]]));
    box.append(panel(L("Registered address spaces","رنج‌های اصلی ثبت‌شده"),
      table([L("Site","شعبه"),"CIDR",L("Name","نام"),L("Action","عملیات")],
        siteSpaces.map(item=>[siteTitle(item.companyId),E("code",{text:item.cidr}),display(item.name),
          link(L("Open IPAM","بازکردن IPAM"),"/ipam/"+encodeURIComponent(item.id))]),
        L("No address spaces","رنجی ثبت نشده است")),
      note(L("Free IP capacity is not estimated from inventory-only counts.","تعداد IPهای آزاد از روی شمارش Inventory حدس زده نمی‌شود."))));
    const inventoryHost=E("div");
    inventoryHost.replaceChildren(makeInventoryTable());
    const search=E("input",{type:"search",placeholder:L("Search registered devices...","جست‌وجوی تجهیزات ثبت‌شده..."),value:query,
      onInput:e=>{query=e.target.value;inventoryHost.replaceChildren(makeInventoryTable());}});
    box.append(panel(L("Device inventory","فهرست تجهیزات"),E("div",{class:"ov-toolbar"},search,
      link(L("Manage devices","مدیریت تجهیزات"),"/inventory")),inventoryHost));
    return box;
  }
  async function loadSite() {
    const id=siteId,token=++run;
    details=null;siteError="";render();
    if (!id) return;
    try { const result=await request("/api/companies/"+encodeURIComponent(id));
      if (token!==run || siteId!==id || tab!=="sites") return;
      details=result;render();
    } catch(e) {if(token===run){siteError=e.message;render();}}
  }
  function renderSites() {
    if (!siteId || !companies().some(x=>x.id===siteId)) siteId=companies()[0]?.id || "";
    const current=companies().find(x=>x.id===siteId);
    const visible=scopedInventory(inventory,siteId);
    const left=panel(L("Branches and sites","فهرست شعب و سایت‌ها"),
      selector(companies().map(x=>[x.id,x.name]),siteId,id=>{siteId=id;loadSite();}), 
      table([L("Name","نام"),L("Kind","نوع"),L("Manager","مدیر"),L("Action","عملیات")],
        companies().map(c=>[E("strong",{text:c.name}),display(c.kind),display(c.managerName),
          action(L("Details","جزئیات"),()=>{siteId=c.id;loadSite();},"sm")]),
        L("No sites registered","سایتی ثبت نشده است")));
    const detail=panel(current?current.name:L("Site details","جزئیات شعبه"));
    if (siteError) detail.append(note(siteError),action(L("Retry","تلاش دوباره"),loadSite));
    else if (!details || details.company?.id!==siteId) detail.append(note(L("Loading site details...","دریافت جزئیات شعبه...")));
    else {
      const c=details.company;
      detail.append(metricBar([[L("Registered devices","تجهیزات ثبت‌شده"),visible.length],
        [L("Address spaces","رنج‌های اصلی"),(details.spaces||[]).length],
        [L("Personnel","پرسنل"),(details.personnel||[]).length],
        [L("Contacts","مخاطبان"),(details.contacts||[]).length]]));
      detail.append(E("dl",{class:"ov-facts"},E("div",{},E("dt",{text:L("Address","نشانی")}),E("dd",{text:display(c.address)})),
        E("div",{},E("dt",{text:L("Manager","مدیر")}),E("dd",{text:display(c.managerName)})),
        E("div",{},E("dt",{text:L("Parent site","سایت مادر")}),E("dd",{text:display(siteTitle(c.parentCompanyId))}))));
      detail.append(E("h4",{text:L("Ranges","رنج‌ها")}),
        table(["CIDR",L("Name","نام"),L("Recorded hosts","میزبان ثبت‌شده"),L("Action","عملیات")],
          (details.spaces||[]).map(s=>[E("code",{text:s.cidr}),display(s.name),number(s.hostCount),
            link(L("Open IPAM","IPAM"),"/ipam/"+encodeURIComponent(s.id))]),
          L("No ranges","رنجی ثبت نشده است")));
      detail.append(E("h4",{text:L("Contacts","افراد تماس")}),
        table([L("Name","نام"),L("Role","سمت"),L("Phone","تلفن")],
          (details.contacts||[]).map(x=>[display(x.fullName),display(x.jobTitle),display(x.phone||x.mobile)]),
          L("No contacts","مخاطبی ثبت نشده است")));
      detail.append(link(L("Open full site management","مدیریت کامل شعبه"),"/company/"+encodeURIComponent(siteId)));
    }
    return E("div",{class:"ov-two"},left,detail);
  }
  function radioGraph(group) {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 860 420");svg.setAttribute("class","ov-graph");
    const make=(type,attributes,textValue)=>{
      const el=document.createElementNS("http://www.w3.org/2000/svg",type);
      Object.entries(attributes).forEach(([k,v])=>el.setAttribute(k,txt(v)));
      if (textValue!==undefined) el.textContent=txt(textValue);
      svg.append(el);return el;
    };
    const stations=group.stations.slice(0,12),total=Math.max(1,stations.length);
    const ax=160,ay=210;
    stations.forEach((st,i)=>{
      const x=470+135*Math.cos(2*Math.PI*i/total),y=210+145*Math.sin(2*Math.PI*i/total);
      make("line",{x1:ax,y1:ay,x2:x,y2:y,class:"ov-link"});
      const distance=distanceKm(group.ap,st);
      if(distance!==null)make("text",{x:(x+ax)/2,y:(y+ay)/2-5,class:"ov-svg-sub"},distance.toFixed(2)+" km");
      make("circle",{cx:x,cy:y,r:15,class:"ov-station "+recordedStatus(st)});
      make("text",{x:x+20,y:y+4,class:"ov-svg-text"},txt(st.name||st.ip).slice(0,19));
    });
    make("circle",{cx:ax,cy:ay,r:30,class:"ov-ap"});
    make("text",{x:ax,y:ay+5,"text-anchor":"middle",class:"ov-svg-aptext"},"AP");
    make("text",{x:ax,y:ay+58,"text-anchor":"middle",class:"ov-svg-text"},display(group.ap.name||group.ap.ip).slice(0,24));
    return svg;
  }
  function renderRadio() {
    const groups=radioGroups(inventory,companyId);
    const selected=groups.aps.find(x=>x.ap.id===apId) || groups.aps[0];
    apId=selected?.ap.id || "";
    const box=E("div",{class:"ov-stack"},
      E("div",{class:"ov-toolbar"},companyControl(id=>{companyId=id;apId="";render();})),
      metricBar([[L("Access points","اکسس پوینت‌ها"),groups.aps.length],
        [L("Stations","کلاینت‌ها"),groups.aps.reduce((n,g)=>n+g.stations.length,0)+groups.orphanStations.length],
        [L("Unlinked stations","کلاینت‌های بدون AP"),groups.orphanStations.length]]));
    const menu=selector(groups.aps.map(g=>[g.ap.id,g.ap.name||g.ap.ip]),apId,id=>{apId=id;render();});
    const content=panel(L("AP-to-station topology (not a geographic map)","اتصال AP به Station (نمودار، نه نقشه جغرافیایی)"),
      note(L("Lines represent saved AP relationships. Distances appear only when both records contain valid GPS coordinates.","خطوط فقط رابطه ثبت‌شده AP و Station هستند؛ فاصله فقط در صورت داشتن مختصات معتبر هر دو دستگاه نمایش داده می‌شود.")),
      E("div",{class:"ov-toolbar"},menu,link(L("Manage radios","مدیریت رادیوها"),"/radios")));
    if (!selected) content.append(note(L("No AP registered in this scope.","در این محدوده AP ثبت نشده است.")));
    else {
      content.append(radioGraph(selected));
      content.append(table([L("Station","Station"),"IP",L("Last manual ping","آخرین پینگ دستی"),L("Straight-line distance","فاصله مستقیم")],
        selected.stations.map(st=>{
          const d=distanceKm(selected.ap,st);
          return [display(st.name),E("code",{text:display(st.ip)}),pingPill(st),d===null?L("No GPS","GPS ثبت نشده"):d.toFixed(2)+" km"];
        }),L("No stations linked to this AP","Station متصل به این AP ثبت نشده است")));
    }
    if (groups.orphanStations.length) box.append(panel(L("Unlinked stations","Stationهای بدون AP"),
      note(groups.orphanStations.map(x=>x.name||x.ip).join(" · "))));
    box.append(content);
    return box;
  }
  async function loadRadius() {
    radiusError="";radius=null;const token=++run;render();
    try {
      const paths=["devices","groups","collections","accounts","events"];
      const results=await Promise.all(paths.map(p=>request("/api/radius-ops/"+p)));
      if(token!==run || tab!=="radius")return;
      radius=Object.fromEntries(paths.map((p,i)=>[p,results[i].items||[]]));render();
    } catch(e) {if(token===run){radiusError=e.message;render();}}
  }
  function renderRadius() {
    if (!modules().has("radius-ops") || !modules().has("radius")) return panel("RADIUS",note(L("RADIUS module is not installed.","ماژول RADIUS نصب نشده است.")));
    if (radiusError) return panel("RADIUS",note(radiusError),action(L("Retry","تلاش دوباره"),loadRadius));
    if (!radius) return panel("RADIUS",note(L("Loading RADIUS records...","دریافت رکوردهای RADIUS...")));
    const box=E("div",{class:"ov-stack"},metricBar([[L("Registered NAS","NAS ثبت‌شده"),radius.devices.length],
      [L("Permission profiles","پروفایل دسترسی"),radius.groups.length],
      [L("NAS collections","مجموعه‌های NAS"),radius.collections.length],
      [L("Accounts","کاربران"),radius.accounts.length]]));
    box.append(panel(L("Permission profiles","پروفایل‌های دسترسی"),
      table([L("Name","نام"),L("Cisco privilege","دسترسی Cisco"),L("MikroTik group","گروه MikroTik"),L("Accounts","کاربران")],
        radius.groups.map(x=>[display(x.name),display(x.ciscoPrivilege),display(x.mikrotikGroup),number(x.members)]),
        L("No profiles","پروفایلی ثبت نشده است"))));
    box.append(panel(L("NAS collections","مجموعه‌های NAS"),
      table([L("Collection","مجموعه"),L("NAS members","تجهیزات عضو"),L("Assigned accounts","کاربران تخصیص‌یافته")],
        radius.collections.map(x=>[display(x.name),number((x.members||[]).length),number(x.assignedUsers)]),
        L("No NAS collections","مجموعه‌ای ثبت نشده است"))));
    box.append(panel(L("Access assignments","تخصیص دسترسی کاربران"),
      table([L("User","کاربر"),L("Collection → profile","مجموعه ← پروفایل"),L("Status","وضعیت")],
        radius.accounts.map(x=>[display(x.username),display((x.accessRules||[]).map(r=>(r.collectionName||"—")+" → "+(r.profileName||"—")).join(" · ")),
          statusPill(x.enabled?"up":"unknown",x.enabled?L("Enabled","فعال"):L("Disabled","غیرفعال"))]),
        L("No accounts","کاربری ثبت نشده است"))));
    box.append(panel(L("Recent authentication events (recorded)","آخرین رویدادهای احراز هویت ثبت‌شده"),
      table([L("User","کاربر"),L("Result","نتیجه"),L("NAS","تجهیز"),L("Time","زمان")],
        radius.events.slice(0,20).map(x=>[display(x.username),statusPill(x.reply==="Access-Accept"?"up":"down",display(x.reply)),
          display(x.deviceLabel||x.sourceIp),display(x.at)]),
        L("No recorded events","رویدادی ثبت نشده است")),
      link(L("Manage RADIUS / groups / NAS","مدیریت کامل RADIUS"),"/module/radius")));
    return box;
  }
  async function loadNetwork() {
    networkError="";network=null;const token=++run;render();
    if (!companyId) return;
    try {
      const data=await request("/api/network-map/state?companyId="+encodeURIComponent(companyId));
      if(token!==run || tab!=="network")return;
      network=data;render();
    } catch(e) {if(token===run){networkError=e.message;render();}}
  }
  function mapGraph(nodes,links,layout) {
    const limit=nodes.slice(0,50),ids=new Set(limit.map(n=>n.id)),pos={};
    limit.forEach((n,i)=>{
      const stored=layout?.positions?.[n.id];
      pos[n.id]=stored && Number.isFinite(Number(stored.x)) && Number.isFinite(Number(stored.y))
        ? {x:Math.max(110,Math.min(1890,Number(stored.x))),y:Math.max(70,Math.min(1100,Number(stored.y)))}
        : {x:160+(i%6)*325,y:110+Math.floor(i/6)*120};
    });
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    // Fit the actual recorded devices; a tiny two-node topology must not be lost in a 2000x1200 canvas.
    const coordinates=Object.values(pos);
    const minX=Math.min(...coordinates.map(p=>p.x),0),maxX=Math.max(...coordinates.map(p=>p.x),0);
    const minY=Math.min(...coordinates.map(p=>p.y),0),maxY=Math.max(...coordinates.map(p=>p.y),0);
    const x0=minX-130,y0=minY-90;
    const width=Math.max(430,maxX-minX+260),height=Math.max(230,maxY-minY+180);
    svg.setAttribute("viewBox",[x0,y0,width,height].join(" "));
    svg.setAttribute("class","ov-graph ov-network-graph");
    const add=(type,props,value,parent=svg)=>{
      const e=document.createElementNS("http://www.w3.org/2000/svg",type);
      Object.entries(props).forEach(([k,v])=>e.setAttribute(k,txt(v)));
      if(value!==undefined)e.textContent=txt(value);parent.append(e);return e;
    };
    links.filter(l=>ids.has(l.source)&&ids.has(l.target)).forEach(l=>{
      const a=pos[l.source],b=pos[l.target];
      add("line",{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:"ov-link"});
    });
    limit.forEach(n=>{
      const p=pos[n.id],status=snapshotStatus(n);
      const group=add("g",{class:"ov-map-node "+status,transform:"translate("+p.x+","+p.y+")",tabindex:"0",role:"button"});
      const pick=()=>{nodeId=n.id;render();};
      group.addEventListener("click",pick);
      group.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick();}});
      add("rect",{x:-100,y:-34,width:200,height:68,rx:12,class:"ov-node-box"},undefined,group);
      add("text",{x:0,y:-5,"text-anchor":"middle",class:"ov-node-name"},txt(n.name||n.address).slice(0,22),group);
      add("text",{x:0,y:16,"text-anchor":"middle",class:"ov-node-ip"},txt(n.address).slice(0,28),group);
    });
    return svg;
  }
  function renderNetwork() {
    const options=companies().map(c=>[c.id,c.name]);
    if (!companyId && options.length===1) companyId=options[0][0];
    const box=E("div",{class:"ov-stack"},
      E("div",{class:"ov-toolbar"},selector([["",L("Choose a site","انتخاب سایت")],...options],companyId,id=>{
        companyId=id;nodeId="";loadNetwork();}),link(L("Full smart map","نقشه هوشمند کامل"),"/module/network-map")));
    if (!companyId) return E("div",{class:"ov-stack"},box,panel(L("Saved topology","توپولوژی ذخیره‌شده"),
      note(L("Choose a site; no discovery runs when opening this page.","یک سایت انتخاب کنید؛ بازکردن این صفحه هیچ اسکن شبکه‌ای انجام نمی‌دهد."))));
    if (!modules().has("network-map")) return panel(L("Network map","نقشه شبکه"),note(L("The network-map module is unavailable.","ماژول نقشه شبکه نصب نشده است.")));
    if (networkError) return E("div",{class:"ov-stack"},box,panel(L("Snapshot error","خطای Snapshot"),note(networkError),action(L("Retry","تلاش دوباره"),loadNetwork)));
    if (!network) return E("div",{class:"ov-stack"},box,panel(L("Saved topology","توپولوژی ذخیره‌شده"),note(L("Loading saved topology...","در حال خواندن نقشه ذخیره‌شده..."))));
    const topology=validTopology(network.topology);
    box.append(metricBar([[L("Saved devices","تجهیزات نقشه"),topology.nodes.length],
      [L("Saved links","ارتباطات ثبت‌شده"),topology.links.length],
      [L("Last-snapshot no response","آخرین Snapshot بدون پاسخ"),topology.nodes.filter(n=>snapshotStatus(n)==="down").length]]));
    const content=panel(L("Saved topology — not real-time monitoring","توپولوژی ذخیره‌شده — بدون مانیتورینگ زنده"),
      note(L("States reflect the last manual collection, not current connectivity.","وضعیت‌ها مربوط به آخرین برداشت دستی هستند، نه ارتباط فعلی تجهیزات.")));
    if (topology.nodes.length) {
      content.append(mapGraph(topology.nodes,topology.links,network.layout));
      if (topology.nodes.length>50)content.append(note(L("The preview shows the first 50 nodes; use full map for all.","پیش‌نمایش ۵۰ گره اول را نشان می‌دهد؛ برای همه گره‌ها نقشه کامل را باز کنید.")));
      const selected=topology.nodes.find(n=>n.id===nodeId);
      if(selected)content.append(panel(L("Selected device","تجهیز انتخاب‌شده"),
        E("dl",{class:"ov-facts"},...[["IP",selected.address],[L("Model","مدل"),selected.model],
          [L("Last collected","آخرین برداشت"),selected.collectedAt],
          [L("Recorded status","وضعیت ثبت‌شده"),selected.status]].map(([a,b])=>
          E("div",{},E("dt",{text:a}),E("dd",{text:display(b)}))))));
      content.append(table([L("Device","تجهیز"),"IP",L("Snapshot status","وضعیت Snapshot"),L("Collected","برداشت")],
        topology.nodes.slice(0,80).map(n=>[display(n.name),E("code",{text:display(n.address)}),
          statusPill(snapshotStatus(n),display(n.status||n.reachability||"unknown")),display(n.collectedAt)]),
        L("No saved nodes","گره‌ای ثبت نشده است")));
    } else content.append(note(L("No topology saved. Use the explicit Create Map action in Smart Network Map.","هنوز نقشه‌ای ذخیره نشده است؛ از داخل ماژول نقشه شبکه، ایجاد نقشه را دستی اجرا کنید.")));
    box.append(content);return box;
  }
  async function loadSelected() {
    if (tab==="sites" && siteId && (!details || details.company?.id!==siteId)) await loadSite();
    if (tab==="radius" && !radius && !radiusError) await loadRadius();
    if (tab==="network" && companyId && !network && !networkError) await loadNetwork();
  }
  async function refresh() {
    const token=++run;error="";details=null;radius=null;network=null;radiusError=networkError=siteError="";
    try {
      const result=await request("/api/inventory");
      if(token!==run)return;
      inventory=Array.isArray(result.items)?result.items:[];render();
      await loadSelected();
    } catch(e){if(token===run){error=e.message;render();}}
  }
  async function openPage() {
    tab="ipam";siteId=companies()[0]?.id||"";companyId=state.currentCompanyId||companyId||"";
    state.view="module";state.currentModuleId="operations-overview";render();
    await refresh();
  }
  return {openPage};
}
