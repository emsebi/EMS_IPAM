// Standalone NAC draft-profile panel; does not invoke device discovery or live RADIUS writes.
export function createProfilesUi(ctx) {
  const {state,page,request,escapeHtml,toast} = ctx;
  const esc = value => escapeHtml(String(value ?? ''));
  const L = (fa,en) => state.language === 'fa' ? fa : en;
  let data={profiles:[],nas:[]},selectedProfileId='',selectedNasId='';
  const el = id => page.querySelector('#'+id);
  const options=(items,value,label)=>items.map(item=>'<option value="'+esc(value(item))+'">'+esc(label(item))+'</option>').join('');
  async function refresh() {
    data=await request('/api/nac/overview');
    if(!data.profiles.some(x=>x.id===selectedProfileId))selectedProfileId='';
    if(!data.nas.some(x=>x.id===selectedNasId))selectedNasId=data.nas[0]?.id||'';
    render();
  }
  function render() {
    const current=data.profiles.find(x=>x.id===selectedProfileId);
    const nas=data.nas.find(x=>x.id===selectedNasId);
    page.innerHTML='<div class="headline"><div><div class="crumb">EMS_IPAM / 05</div><h2>'+
      esc(L('کنترل دسترسی شبکه / NAC','Network Access / NAC'))+'</h2></div></div>'+
      '<div class="nac-warning"><b>'+esc(L('فقط پیش‌نویس / بدون اعمال روی شبکه','DRAFT ONLY / NOT ENFORCED'))+
      '</b><p>'+esc(L('این پروفایل‌ها هنوز به مسیر احراز هویت زنده FreeRADIUS متصل نیستند. تغییر هیچ پورت یا سوئیچی خودکار انجام نمی‌شود.',
      'These profiles are not wired into live FreeRADIUS authorization. No switch or port is modified automatically.'))+'</p></div>'+
      '<div class="nac-grid"><section class="panel"><h3>'+esc(L('پروفایل‌های سیاست','Policy profiles'))+'</h3>'+
      '<label>'+esc(L('انتخاب پروفایل','Choose profile'))+'<select id="nacProfileChoice"><option value="">'+esc(L('پروفایل جدید','New profile'))+'</option>'+
      options(data.profiles,x=>x.id,x=>x.name)+'</select></label>'+
      '<label>'+esc(L('نام','Name'))+'<input id="nacProfileName" maxlength="120" autocomplete="off"></label>'+
      '<label>'+esc(L('توضیحات','Description'))+'<input id="nacDescription" maxlength="500"></label>'+
      '<label>'+esc(L('MAC ثبت‌شده','Registered MAC'))+'<select id="nacKnownMode">'+
      '<option value="accept-static">'+esc(L('مجاز؛ VLAN پورت','Allow; port VLAN'))+'</option>'+
      '<option value="accept-vlan">'+esc(L('مجاز؛ VLAN مشخص','Allow; assigned VLAN'))+'</option>'+
      '<option value="reject">Reject</option></select></label>'+
      '<label>'+esc(L('VLAN دستگاه ثبت‌شده','Registered VLAN'))+'<input id="nacKnownVlan" inputmode="numeric" type="number" min="1" max="4094"></label>'+
      '<label>'+esc(L('MAC ناشناس','Unknown MAC'))+'<select id="nacUnknownMode"><option value="reject">Reject</option>'+
      '<option value="guest-vlan">'+esc(L('VLAN میهمان در سوئیچ','Guest VLAN on switch'))+'</option></select></label>'+
      '<label>'+esc(L('VLAN میهمان','Guest VLAN'))+'<input id="nacGuestVlan" inputmode="numeric" type="number" min="1" max="4094"></label>'+
      '<label class="nac-inline"><input type="checkbox" id="nacProfileEnabled">'+esc(L('فعال برای شبیه‌سازی','Enable for dry-run'))+'</label>'+
      '<div class="nac-actions"><button id="nacSaveProfile" class="btn primary">'+esc(L('ذخیره پروفایل','Save profile'))+'</button>'+
      '<button id="nacDeleteProfile" class="btn">'+esc(L('حذف','Delete'))+'</button></div></section>'+
      '<section class="panel"><h3>'+esc(L('سیاست هر سوئیچ','Per-switch assignment'))+'</h3>'+
      '<label>'+esc(L('NAS ثبت‌شده در RADIUS','Registered NAS'))+'<select id="nacNasChoice">'+
      options(data.nas,x=>x.id,x=>x.label+' — '+x.nasIp+' ('+x.vendor+')')+'</select></label>'+
      '<label>'+esc(L('پروفایل سوئیچ','Switch profile'))+'<select id="nacBindingProfile"><option value="">'+esc(L('بدون تخصیص','Unassigned'))+'</option>'+
      options(data.profiles,x=>x.id,x=>x.name)+'</select></label>'+
      '<label class="nac-inline"><input id="nacBindingEnabled" type="checkbox">'+esc(L('فعال در شبیه‌سازی','Enable in dry-run'))+'</label>'+
      '<button id="nacSaveBinding" class="btn primary">'+esc(L('ذخیره تخصیص سوئیچ','Save switch binding'))+'</button>'+
      '<h3>'+esc(L('استثنای MAC روی همین سوئیچ','Per-switch MAC exception'))+'</h3>'+
      '<label>MAC<input id="nacRuleMac" placeholder="00:11:22:33:44:66" autocomplete="off"></label>'+
      '<label>'+esc(L('تصمیم','Decision'))+'<select id="nacRuleMode"><option value="reject">Reject</option>'+
      '<option value="accept-static">'+esc(L('اجازه؛ VLAN پورت','Allow; port VLAN'))+'</option>'+
      '<option value="accept-vlan">'+esc(L('اجازه؛ VLAN مشخص','Allow; assigned VLAN'))+'</option></select></label>'+
      '<label>VLAN<input id="nacRuleVlan" inputmode="numeric" type="number" min="1" max="4094"></label>'+
      '<label>'+esc(L('یادداشت','Note'))+'<input id="nacRuleNote" maxlength="500"></label>'+
      '<label class="nac-inline"><input id="nacRuleEnabled" type="checkbox" checked>'+esc(L('فعال برای شبیه‌سازی','Enabled for dry-run'))+'</label>'+
      '<button id="nacSaveRule" class="btn">'+esc(L('ذخیره استثنا','Save exception'))+'</button>'+
      '<div id="nacRules"></div></section>'+
      '<section class="panel"><h3>'+esc(L('تست تصمیم بدون اعمال','Policy dry-run'))+'</h3>'+
      '<label>MAC<input id="nacPreviewMac" placeholder="00:11:22:33:44:66" autocomplete="off"></label>'+
      '<button id="nacRunPreview" class="btn primary">'+esc(L('شبیه‌سازی','Simulate'))+'</button>'+
      '<pre id="nacPreviewResult" class="nac-output"></pre>'+
      '<h3>'+esc(L('دستورات پیشنهادی سوئیچ','Switch CLI draft'))+'</h3>'+
      '<p>'+esc(L('فقط برای پورت Access آزمایشی؛ مدل و نسخه IOS/RouterOS، VLAN، Voice و مسیر دسترسی مدیریتی را قبل از اجرا بررسی کنید.',
      'For an isolated access port only. Verify model/OS, VLAN, voice and management recovery before using.'))+'</p>'+
      '<label>'+esc(L('نوع سوئیچ برای دستورات','Switch type for CLI draft'))+'<select id="nacVendorChoice">'+
      '<option value="">'+esc(L('مدل را انتخاب کنید','Choose/confirm model'))+'</option>'+
      '<option value="cisco-legacy">Cisco Catalyst legacy IOS</option>'+
      '<option value="cisco-ios">Cisco IOS</option>'+
      '<option value="mikrotik">MikroTik RouterOS</option></select></label>'+ 
      '<label>'+esc(L('IP سرور RADIUS','RADIUS server IP'))+'<input id="nacRadiusIp" placeholder="192.0.2.10"></label>'+
      '<label>'+esc(L('نام پورت','Interface'))+'<input id="nacInterface" placeholder="'+(nas?.vendor==='mikrotik'?'ether4':'GigabitEthernet1/0/4')+'"></label>'+
      '<button id="nacShowConfig" class="btn">'+esc(L('نمایش دستورات','Generate review-only CLI'))+'</button>'+
      '<textarea id="nacConfig" class="nac-output" readonly rows="14" spellcheck="false"></textarea>'+
      '</section></div>';
    el('nacProfileChoice').value=selectedProfileId;
    el('nacProfileName').value=current?.name||'';
    el('nacDescription').value=current?.description||'';
    el('nacKnownMode').value=current?.knownMode||'accept-static';
    el('nacKnownVlan').value=current?.knownVlan??'';
    el('nacUnknownMode').value=current?.unknownMode||'reject';
    el('nacGuestVlan').value=current?.guestVlan??'';
    el('nacProfileEnabled').checked=current?.enabled??false;
    el('nacNasChoice').value=selectedNasId;
    if (nas && nas.vendor !== 'other') el('nacVendorChoice').value=nas.vendor;
    el('nacBindingProfile').value=nas?.profileId||'';
    el('nacBindingEnabled').checked=nas?.bindingEnabled??false;
    el('nacDeleteProfile').disabled=!selectedProfileId;
    el('nacProfileChoice').onchange=()=>{selectedProfileId=el('nacProfileChoice').value;render();};
    el('nacNasChoice').onchange=()=>{selectedNasId=el('nacNasChoice').value;render();};
    el('nacSaveProfile').onclick=async()=> {
      try{
        const body={name:el('nacProfileName').value,description:el('nacDescription').value,
          enabled:el('nacProfileEnabled').checked,knownMode:el('nacKnownMode').value,
          knownVlan:el('nacKnownMode').value==='accept-vlan'?el('nacKnownVlan').value:null,
          unknownMode:el('nacUnknownMode').value,
          guestVlan:el('nacUnknownMode').value==='guest-vlan'?el('nacGuestVlan').value:null};
        const result=await request(selectedProfileId?'/api/nac/profiles/'+encodeURIComponent(selectedProfileId):'/api/nac/profiles',
          {method:selectedProfileId?'PUT':'POST',body});
        selectedProfileId=result.profile.id;await refresh();toast(L('پروفایل پیش‌نویس ذخیره شد','Draft profile saved'));
      }catch(e){toast(e.message);}
    };
    el('nacDeleteProfile').onclick=async()=>{
      if(!selectedProfileId||!confirm(L('پروفایل حذف شود؟','Delete this profile?')))return;
      try{await request('/api/nac/profiles/'+encodeURIComponent(selectedProfileId),{method:'DELETE'});selectedProfileId='';await refresh();}catch(e){toast(e.message);}
    };
    el('nacSaveBinding').onclick=async()=>{
      try{
        if(!selectedNasId||!el('nacBindingProfile').value)throw new Error(L('ابتدا NAS و پروفایل انتخاب کنید','Select NAS and profile'));
        await request('/api/nac/nas/'+encodeURIComponent(selectedNasId),{method:'PUT',
          body:{profileId:el('nacBindingProfile').value,enabled:el('nacBindingEnabled').checked}});
        await refresh();toast(L('تخصیص آزمایشی ذخیره شد','Draft assignment saved'));
      }catch(e){toast(e.message);}
    };
    el('nacSaveRule').onclick=async()=>{
      try{
        if(!selectedNasId)throw new Error(L('NAS انتخاب نشده','Choose a NAS'));
        const mac=el('nacRuleMac').value.trim();
        const mode=el('nacRuleMode').value;
        await request('/api/nac/nas/'+encodeURIComponent(selectedNasId)+'/rules/'+encodeURIComponent(mac),{method:'PUT',
          body:{mode,vlan:mode==='accept-vlan'?el('nacRuleVlan').value:null,enabled:el('nacRuleEnabled').checked,note:el('nacRuleNote').value}});
        await loadRules();toast(L('استثنا ذخیره شد؛ فقط پیش‌نویس','Rule saved as draft'));
      }catch(e){toast(e.message);}
    };
    el('nacRunPreview').onclick=async()=>{
      try{
        if(!selectedNasId)throw new Error(L('NAS انتخاب نشده','Choose a NAS'));
        const r=await request('/api/nac/preview?nasId='+encodeURIComponent(selectedNasId)+'&mac='+encodeURIComponent(el('nacPreviewMac').value.trim()));
        el('nacPreviewResult').textContent=JSON.stringify(r.result,null,2)+'\n'+r.caveat;
      }catch(e){toast(e.message);}
    };
    el('nacShowConfig').onclick=async()=>{
      try{
        if(!selectedNasId)throw new Error(L('NAS انتخاب نشده','Choose a NAS'));
        const r=await request('/api/nac/nas/'+encodeURIComponent(selectedNasId)+'/config?interface='+
          encodeURIComponent(el('nacInterface').value.trim())+'&radiusIp='+encodeURIComponent(el('nacRadiusIp').value.trim())+
          '&vendor='+encodeURIComponent(el('nacVendorChoice').value));
        el('nacConfig').value=r.text;
      }catch(e){toast(e.message);}
    };
    loadRules().catch(e=>toast(e.message));
  }
  async function loadRules(){
    const target=el('nacRules');
    if(!target||!selectedNasId){if(target)target.textContent='';return;}
    const nasId=selectedNasId;
    const r=await request('/api/nac/nas/'+encodeURIComponent(nasId)+'/rules');
    if(nasId!==selectedNasId||!el('nacRules'))return;
    el('nacRules').innerHTML=(r.items||[]).map(item=>'<div class="nac-rule"><span>'+
      esc(item.mac+' · '+item.mode+(item.vlan?' · VLAN '+item.vlan:'')+(item.enabled?'':' · disabled'))+'</span>'+
      '<button type="button" class="btn sm" data-mac="'+esc(item.mac)+'">'+esc(L('حذف','Delete'))+'</button></div>').join('');
    el('nacRules').querySelectorAll('button[data-mac]').forEach(button=>button.onclick=async()=>{
      try{await request('/api/nac/nas/'+encodeURIComponent(selectedNasId)+'/rules/'+encodeURIComponent(button.dataset.mac),{method:'DELETE'});await loadRules();}catch(e){toast(e.message);}
    });
  }
  return {openPage:async()=>{try{await refresh();}catch(e){toast(e.message);}}};
}
