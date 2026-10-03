export function createUi(ctx) {
  const {state,$,page,request,isAdmin,ensureInventory,escapeHtml,formatNumber,populateHostTypes,navActive,setRoute,translateTree,toast} = ctx;
  async function openDeviceTypesPage() {
    if (!isAdmin()) return toast('دسترسی فقط برای مدیر سیستم مجاز است.');
    const [result] = await Promise.all([request('/api/device-types'),ensureInventory(true)]);
    state.deviceTypes=result.items||[];
    state.view='device-types';state.currentSpaceId=null;state.data=null;
    navActive('deviceTypes');setRoute('/device-types');
    page.innerHTML=`<div class="headline"><div><div class="crumb">IP Manager / Device Types</div><h2>انواع تجهیزات</h2><div class="subtitle">این فهرست در فرم اطلاعات IP و فیلتر دستگاه‌ها استفاده می‌شود.</div></div></div>
    <section class="panel types-panel"><form id="deviceTypeForm" class="type-editor"><input id="deviceTypeId" type="hidden"><label class="field">نام نوع تجهیز<input id="deviceTypeName" required maxlength="100" placeholder="Switch / Laptop / Printer"></label><label class="field">رنگ<input id="deviceTypeColor" type="color" value="#3157d5"></label><div class="row-actions"><button class="btn primary" type="submit">ذخیره نوع</button><button id="cancelDeviceTypeEdit" class="btn hidden" type="button">انصراف</button></div><p id="deviceTypeError" class="form-error" role="alert"></p></form><div id="deviceTypesList" class="table-list"></div></section>`;
    renderList();
    $('deviceTypeForm').addEventListener('submit',async(event)=>{
      event.preventDefault();const form=event.currentTarget;const button=form.querySelector('[type=submit]');button.disabled=true;$('deviceTypeError').textContent='';
      try{
        const id=$('deviceTypeId').value;
        await request(id?`/api/device-types/${encodeURIComponent(id)}`:'/api/device-types',{method:id?'PUT':'POST',body:{name:$('deviceTypeName').value,color:$('deviceTypeColor').value}});
        await openDeviceTypesPage();populateHostTypes();toast('نوع تجهیز ذخیره شد.');
      }catch(error){$('deviceTypeError').textContent=error.message;}finally{button.disabled=false;}
    });
    $('cancelDeviceTypeEdit').addEventListener('click',()=>{$('deviceTypeForm').reset();$('deviceTypeId').value='';$('cancelDeviceTypeEdit').classList.add('hidden');$('deviceTypeError').textContent='';});
    translateTree(page);
  }
  function renderList(){
    const list=$('deviceTypesList');
    list.innerHTML=state.deviceTypes.map((item)=>`<div class="user-row"><div><b>${escapeHtml(item.name)}</b><small><i class="swatch" style="background:${escapeHtml(item.color)}"></i> ${formatNumber(state.inventory.filter((h)=>h.type===item.name).length)} دستگاه</small></div><div class="row-actions"><button class="btn sm edit-device-type" data-id="${escapeHtml(item.id)}">ویرایش</button><button class="btn sm danger delete-device-type" data-id="${escapeHtml(item.id)}">حذف</button></div></div>`).join('')||'<div class="empty-state">نوع تجهیزی ثبت نشده است.</div>';
    list.querySelectorAll('.edit-device-type').forEach((button)=>button.addEventListener('click',()=>{const item=state.deviceTypes.find((i)=>i.id===button.dataset.id);$('deviceTypeId').value=item.id;$('deviceTypeName').value=item.name;$('deviceTypeColor').value=item.color||'#3157d5';$('cancelDeviceTypeEdit').classList.remove('hidden');$('deviceTypeName').focus();}));
    list.querySelectorAll('.delete-device-type').forEach((button)=>button.addEventListener('click',async()=>{if(!confirm('این نوع تجهیز حذف شود؟'))return;button.disabled=true;try{await request(`/api/device-types/${encodeURIComponent(button.dataset.id)}`,{method:'DELETE'});await openDeviceTypesPage();toast('نوع تجهیز حذف شد.');}catch(error){$('deviceTypeError').textContent=error.message;button.disabled=false;}}));
  }
  return {openDeviceTypesPage};
}
