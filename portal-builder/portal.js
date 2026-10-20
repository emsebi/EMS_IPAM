(function(){'use strict';
function each(q,fn){Array.prototype.forEach.call(document.querySelectorAll(q),fn);}
function decode(s){try{return decodeURIComponent(s.replace(/\+/g,' '));}catch(e){return '';}}
each('[data-user]',function(el){var s=decode(el.getAttribute('data-user')||'');if(s&&s.indexOf('$(')<0){el.textContent=s;}});
each('[data-username]',function(el){var s=decode(el.getAttribute('data-username')||'');if(s.indexOf('$(')<0)el.value=s;});
each('[data-date]',function(el){try{el.textContent=new Intl.DateTimeFormat('fa-IR',{weekday:'long',day:'numeric',month:'long'}).format(new Date());}catch(e){el.textContent='';}});
each('[data-toggle-password]',function(btn){btn.addEventListener('click',function(){var p=document.getElementById('password'),on=p.type==='password';p.type=on?'text':'password';btn.setAttribute('aria-pressed',String(on));btn.setAttribute('aria-label',on?'پنهان‌کردن رمز عبور':'نمایش رمز عبور');});});
each('[data-reload]',function(b){b.addEventListener('click',function(){window.location.reload();});});
each('[data-error]',function(el){var raw=decode(el.getAttribute('data-encoded-error')||'');if(raw&&raw.indexOf('$(')<0)el.textContent=raw;var t=el.textContent.toLowerCase();var fa='';if(/invalid username or password|invalid password/.test(t))fa='نام کاربری یا رمز عبور صحیح نیست.';else if(/simultaneous|already logged/.test(t))fa='این حساب در دستگاه دیگری فعال است. با پشتیبانی شبکه هماهنگ کنید.';else if(/uptime limit|session time|traffic limit/.test(t))fa='زمان یا حجم مجاز این حساب پایان یافته است.';else if(/radius.*(not responding|timeout)|authentication server/.test(t))fa='سرویس ورود پاسخ نمی‌دهد؛ کمی بعد دوباره تلاش کنید.';if(fa)el.textContent=fa;});
var favorites=[],key='organization-portal-favorites-v1';
try{var saved=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(saved))favorites=saved.filter(function(x){return typeof x==='string';});}catch(e){}
var filter='all',input=document.getElementById('app-search'),cards=Array.prototype.slice.call(document.querySelectorAll('[data-app]'));
function normalize(s){return s.replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\u200c/g,' ').toLowerCase().trim();}
function paint(){var q=normalize(input?input.value:''),visible=0;cards.forEach(function(card){var id=card.getAttribute('data-app'),fav=favorites.indexOf(id)>=0,btn=card.querySelector('.favorite');if(btn){btn.setAttribute('aria-pressed',String(fav));btn.setAttribute('aria-label',(fav?'حذف از علاقه‌مندی‌ها: ':'افزودن به علاقه‌مندی‌ها: ')+card.querySelector('.app-name').textContent);}
var match=(!q||normalize(card.textContent).indexOf(q)>=0)&&(filter==='all'||filter==='favorites'&&fav||card.getAttribute('data-category')===filter);card.hidden=!match;if(match)visible++;});
var empty=document.getElementById('empty-apps');if(empty)empty.hidden=visible>0;var count=document.getElementById('result-count');if(count)count.textContent=String(visible);}
each('.favorite',function(btn){btn.hidden=false;btn.addEventListener('click',function(){var id=btn.closest('[data-app]').getAttribute('data-app'),i=favorites.indexOf(id);if(i<0)favorites.push(id);else favorites.splice(i,1);try{localStorage.setItem(key,JSON.stringify(favorites));}catch(e){}paint();});});
each('[data-filter]',function(btn){btn.addEventListener('click',function(){filter=btn.getAttribute('data-filter');each('[data-filter]',function(x){x.setAttribute('aria-pressed',String(x===btn));});paint();});});
if(input)input.addEventListener('input',paint);each('[data-enhanced]',function(el){el.hidden=false;});paint();
if(document.body.hasAttribute('data-preview')){document.addEventListener('submit',function(e){e.preventDefault();e.stopImmediatePropagation();var f=e.target;location.href=f.getAttribute('data-demo-target')||'status.html';},true);each('[data-trial]',function(a){a.addEventListener('click',function(e){e.preventDefault();location.href='guest.html';});});}
})();