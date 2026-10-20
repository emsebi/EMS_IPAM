from html import escape as esc
from urllib.parse import urlsplit

ICONS={
'grid':'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
'shield':'<path d="M12 3 4.5 6v5c0 5 7.5 10 7.5 10S19.5 16 19.5 11V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
'arrow':'<path d="M18 12H6m5-5-5 5 5 5"/>',
'external':'<path d="M14 4h6v6m0-6-9 9"/><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
'search':'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
'star':'<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4-4.6-4.5 6.4-.9Z"/>',
'user':'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
'lock':'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3m-5 5v2"/>',
'eye':'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
'logout':'<path d="M10 4H5v16h5m5-13 5 5-5 5m-5-5h10"/>',
'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
'download':'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
'upload':'<path d="M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5"/>',
'network':'<rect x="8" y="3" width="8" height="5" rx="1"/><path d="M12 8v5M4 16v-3h16v3"/><rect x="1.5" y="16" width="5" height="5" rx="1"/><rect x="9.5" y="16" width="5" height="5" rx="1"/><rect x="17.5" y="16" width="5" height="5" rx="1"/>',
'reload':'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 7a7.5 7.5 0 0 1 13 0L20 12M4 12l1.5 5a7.5 7.5 0 0 0 13 0"/>',
'doc':'<path d="M6 3h8l4 4v14H6Zm8 0v5h4M9 12h6m-6 4h6"/>',
'layers':'<path d="m12 3 10 6-10 6L2 9Zm-9 12 9 5 9-5M3 19l9 5 9-5" transform="translate(0 -1) scale(1 .9)"/>',
'mail':'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
'people':'<circle cx="9" cy="8" r="3.5"/><path d="M2 21v-2a7 7 0 0 1 14 0v2m0-17a4 4 0 0 1 0 8m3 3a6 6 0 0 1 3 5v1"/>',
'chart':'<path d="M4 3v17h17M9 16V9m5 7V5m5 11v-5"/>',
'info':'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
'calendar':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>'
}
def icon(name):
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS.get(name,ICONS['grid'])+'</svg>'
def logo(p):
    return '<a class="brand" href="$(link-status)" aria-label="داشبورد سازمانی"><img src="assets/logo.webp" width="600" height="133" alt="'+esc(p['brand'],quote=True)+'"></a>'
def head(title):
    return '<!doctype html>\n<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><meta http-equiv="pragma" content="no-cache"><meta http-equiv="expires" content="-1"><title>'+esc(title)+'</title><link rel="stylesheet" href="assets/portal.css"></head>'
def foot(p):
    return '<footer class="page-footer"><span>'+esc(p['brand'])+' · پرتال خدمات سازمانی</span><span>ارائه شده توسط <bdi>'+esc(p['credit'])+'</bdi></span></footer>'
def card(app,i):
    name=esc(app['name']); desc=esc(app['description']); internal=app['internal']
    return '<article class="service-card" data-app="'+str(i)+'" data-category="'+app['category']+'" style="animation-delay:'+str(i*35)+'ms"><a href="'+esc(app['url'],quote=True)+'" target="_blank" rel="noopener noreferrer"><div class="app-top"><span class="app-icon">'+icon(app['icon'])+'</span><span class="app-network">'+('شبکه داخلی' if internal else 'سامانه تحت وب')+'</span></div><strong class="app-name">'+name+'</strong><span class="app-desc">'+desc+'</span><span class="app-bottom"><span>ورود به سامانه</span>'+icon('external')+'</span></a><button class="favorite" type="button" aria-pressed="false" aria-label="افزودن به علاقه‌مندی‌ها: '+name+'" hidden>'+icon('star')+'</button></article>'
def metric(label,value,ico,fa=False):
    return '<div class="metric"><span class="metric-label">'+icon(ico)+label+'</span><strong class="metric-value'+(' fa' if fa else '')+'">'+value+'</strong></div>'
def dashboard(p,connected=True):
    # All private organization data is supplied at build time.
    count=len(p['apps']); internal=sum(a['internal'] for a in p['apps'])
    sidebar='<aside class="sidebar">'+logo(p)+'<span class="brand-caption">پرتال خدمات سازمانی</span><nav class="nav" aria-label="منوی اصلی"><a class="active" href="#dashboard">'+icon('grid')+'داشبورد</a><a href="#services">'+icon('layers')+'سامانه‌ها</a><a href="#session">'+icon('shield')+'وضعیت اتصال</a></nav><div class="sidebar-note"><strong>همراه روز کاری شما</strong>دسترسی یکپارچه به سامانه‌های سازمان</div></aside>'
    if connected:
        headline='$(if login-by == "trial")خوش آمدید، کاربر میهمان$(else)خوش آمدید، <bdi class="username" data-user="$(username-esc)">همکار گرامی</bdi>$(endif)'
        subtitle='سامانه‌های کاری و اطلاعات اتصال شما، در یک داشبورد.'
        badge='$(if login-by == "trial")اتصال میهمان فعال است$(else)نشست اینترنت فعال است$(endif)'
        note='وضعیت احراز هویت شما در شبکه سازمانی'
        action='<button class="icon-button" type="button" data-reload aria-label="به‌روزرسانی وضعیت" title="به‌روزرسانی وضعیت">'+icon('reload')+'</button><form action="$(link-logout)" method="post" data-demo-target="logout.html"><input type="hidden" name="erase-cookie" value="on"><button class="button danger" type="submit">'+icon('logout')+'قطع اینترنت</button></form>'
        metrics=metric('آدرس دستگاه','$(ip)','network')+metric('زمان اتصال','$(uptime)','clock')+metric('دریافت اطلاعات','$(bytes-out-nice)','download')+metric('ارسال اطلاعات','$(bytes-in-nice)','upload')
        session='<dl><div class="row"><dt>نام کاربری</dt><dd>$(if login-by == "trial")کاربر میهمان$(else)<bdi data-user="$(username-esc)">کاربر</bdi>$(endif)</dd></div><div class="row"><dt>آدرس MAC</dt><dd>$(mac)</dd></div>$(if session-time-left)<div class="row"><dt>زمان باقی‌مانده</dt><dd>$(session-time-left)</dd></div>$(endif)</dl>'
        helptext='برای پایان‌دادن به نشست اینترنت، دکمهٔ «قطع اینترنت» را بزنید. بستن این صفحه به‌تنهایی ارتباط را قطع نمی‌کند.'
    else:
        headline='سامانه‌های شما، همین‌جا هستند'
        subtitle='برای استفاده از اینترنت دوباره وارد شوید. میان‌بر سامانه‌ها همچنان در این داشبورد قرار دارد.'
        badge='نشست اینترنت فعال نیست'
        note='برای اتصال مجدد از دکمهٔ ورود استفاده کنید.'
        action='<a class="button" href="$(link-login-only)">'+icon('arrow')+'ورود به اینترنت</a>'
        metrics=metric('سامانه‌های سازمانی',str(count),'grid')+metric('سامانه‌های داخلی',str(internal),'network')+metric('سامانه‌های تحت وب',str(count-internal),'layers')+metric('وضعیت نشست','پایان‌یافته','shield',True)
        session='<dl><div class="row"><dt>وضعیت</dt><dd>خارج از نشست اینترنت</dd></div><div class="row"><dt>آدرس دستگاه</dt><dd>$(ip)</dd></div>$(if uptime)<div class="row"><dt>مدت نشست قبلی</dt><dd>$(uptime)</dd></div>$(endif)</dl>'
        helptext='دسترسی به سامانه‌ها پس از خروج، تابع مجوزهای شبکه است. اگر سامانه‌ای باز نشد، ابتدا وارد اینترنت شوید یا با پشتیبانی شبکه هماهنگ کنید.'
    hero='<section class="hero" id="dashboard"><div class="orbit" aria-hidden="true"><span class="orbit-dot"></span></div><div class="hero-copy"><p class="overline">WORKPLACE / DIGITAL SERVICES</p><h1>'+headline+'</h1><p>'+subtitle+'</p></div></section>'
    strip='<section class="status-strip'+('' if connected else ' offline')+'" aria-label="وضعیت نشست"><div class="connection"><span class="state-dot" aria-hidden="true"></span><span><strong>'+badge+'</strong><small>'+note+'</small></span></div><div class="actions">'+action+'</div></section>'
    services='<section class="services" id="services"><div class="section-heading"><div><h2>سامانه‌های کاری شما</h2><p>مسیر کوتاه‌تر برای کارهای روزانه</p></div><label class="search" data-enhanced hidden>'+icon('search')+'<span class="sr-only">جست‌وجو در سامانه‌ها</span><input id="app-search" type="search" placeholder="نام سامانه را جست‌وجو کنید…" autocomplete="off"></label></div><div class="filters" data-enhanced hidden aria-label="دسته‌بندی سامانه‌ها"><button class="filter" data-filter="all" aria-pressed="true">همهٔ سامانه‌ها</button><button class="filter" data-filter="admin" aria-pressed="false">اداری و منابع انسانی</button><button class="filter" data-filter="operations" aria-pressed="false">عملیات و مشتریان</button><button class="filter" data-filter="favorites" aria-pressed="false">علاقه‌مندی‌ها</button></div><div class="service-grid">'+''.join(card(a,i) for i,a in enumerate(p['apps']))+'</div><p class="empty" id="empty-apps" hidden>سامانه‌ای با این انتخاب پیدا نشد.</p><span class="sr-only" aria-live="polite">تعداد نتایج: <span id="result-count">'+str(count)+'</span></span></section>'
    details='<section class="details" id="session"><div class="info-box"><h2>'+icon('shield')+'جزئیات اتصال</h2>'+session+'</div><div class="info-box"><h2>'+icon('info')+'راهنمای دسترسی</h2><p>'+helptext+'</p></div></section>'
    return head('داشبورد سازمانی | '+p['brand'])+'<body><a class="skip" href="#main">رفتن به محتوای اصلی</a><div class="shell">'+sidebar+'<main class="main" id="main"><header class="topbar"><div><span class="eyebrow">'+esc(p['brand'])+' / خدمات دیجیتال</span><p class="topbar-title">داشبورد سازمانی</p></div><div class="date">'+icon('calendar')+'<span data-date></span></div></header>'+hero+strip+'<section class="metrics" aria-label="خلاصه وضعیت">'+metrics+'</section>'+services+details+foot(p)+'</main></div><script src="assets/portal.js"></script></body></html>'
def login(p):
    chap=r'''$(if chap-id)
<form name="sendin" action="$(link-login-only)" method="post" hidden>
<input type="hidden" name="username"><input type="hidden" name="password"><input type="hidden" name="dst" value="$(link-status)"><input type="hidden" name="popup" value="false">
</form><script src="assets/md5.js"></script><script>
function doLogin(){var f=document.forms.login,s=document.forms.sendin;
s.elements.username.value=f.elements.username.value;
s.elements.password.value=hexMD5('$(chap-id)'+f.elements.password.value+'$(chap-challenge)');
s.submit();return false;}
</script>$(endif)'''
    story='<section class="login-story" aria-label="معرفی پرتال"><div><p class="overline">ORGANIZATION / CONNECTED WORKPLACE</p><h1>شروع یک روز کاری،<br>از یک نقطه.</h1><p>به اینترنت سازمانی متصل شوید و سامانه‌های موردنیازتان را در داشبورد یکپارچهٔ سازمان پیدا کنید.</p></div><div class="orbit" aria-hidden="true"><span class="orbit-dot"></span></div><div class="story-note">'+icon('shield')+'دسترسی سازمانی برای همکاران و میهمانان مجاز</div></section>'
    form=r'''<form name="login" action="$(link-login-only)" method="post" data-demo-target="status.html" $(if chap-id)onsubmit="return doLogin()"$(endif)>
<input type="hidden" name="dst" value="$(link-status)"><input type="hidden" name="popup" value="false">
<div class="field"><label for="username">نام کاربری</label><div class="input-wrap">'''+icon('user')+r'''<input id="username" name="username" type="text" data-username="$(username-esc)" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="نام کاربری سازمانی" required></div></div>
<div class="field"><label for="password">رمز عبور</label><div class="input-wrap">'''+icon('lock')+r'''<input id="password" name="password" type="password" autocomplete="current-password" placeholder="رمز عبور" required><button class="password-toggle" type="button" data-toggle-password aria-label="نمایش رمز عبور" aria-pressed="false" aria-controls="password">'''+icon('eye')+r'''</button></div></div>
$(if error)<p class="notice error" role="alert" data-error data-encoded-error="$(error-esc)">ورود انجام نشد. اطلاعات حساب را بررسی کنید.</p>$(endif)
<button class="button login-submit" type="submit">ورود و اتصال به اینترنت '''+icon('arrow')+r'''</button></form>
$(if trial == 'yes')<a class="trial-link" data-trial href="$(link-login-only)?dst=$(link-status-esc)&amp;username=T-$(mac-esc)&amp;popup=false">ورود کاربر میهمان</a>$(endif)
<noscript><p class="notice">برای ورود با روش CHAP، JavaScript مرورگر باید فعال باشد.</p></noscript>'''
    return head('ورود به اینترنت | '+p['brand'])+'<body>'+chap+'<main class="login-shell"><div class="login-frame">'+story+'<section class="login-content">'+logo(p)+'<h2>ورود به اینترنت سازمانی</h2><p class="subtitle">از حساب کاربری اختصاصی خود استفاده کنید.</p>'+form+'<p class="login-help">اگر در ورود مشکل دارید، با پشتیبانی شبکهٔ سازمان هماهنگ کنید.</p><div class="login-footer">'+esc(p['credit'])+' · '+esc(p['brand'])+'</div></section></div></main><script src="assets/portal.js"></script></body></html>'
def utility(p,title,text,link='$(link-login-only)',button='بازگشت به ورود',redirect=False):
    page=head(title+' | '+p['brand'])
    if redirect:
        page=page.replace('</head>','<meta http-equiv="refresh" content="0;url='+link+'"></head>')
    return page+'<body><main class="utility">'+logo(p)+'<h1>'+title+'</h1><p>'+text+'</p><a class="button" href="'+link+'">'+button+icon('arrow')+'</a></main></body></html>'
def pages(p):
    return {
      'login.html':login(p),
      'status.html':dashboard(p,True),
      'logout.html':dashboard(p,False),
      'fstatus.html':dashboard(p,False),
      'flogout.html':dashboard(p,False),
      'alogin.html':utility(p,'ورود موفق','در حال بازکردن داشبورد سازمانی…','$(link-status)','رفتن به داشبورد',True),
      'rstatus.html':utility(p,'داشبورد سازمانی','در حال بازکردن داشبورد…','$(link-status)','داشبورد',True),
      'rlogin.html':utility(p,'ورود به شبکه','در حال بازکردن صفحهٔ ورود…','$(link-login)','ادامه',True),
      'redirect.html':utility(p,'در حال انتقال','برای ادامه از دکمهٔ زیر استفاده کنید.','$(link-redirect)','ادامه',True),
      'error.html':utility(p,'ورود انجام نشد','<span data-error data-encoded-error="$(error-esc)">خطایی در ارتباط با شبکه رخ داد. دوباره تلاش کنید.</span>').replace('</body>','<script src="assets/portal.js"></script></body>'),
      'radvert.html':utility(p,'پیام شبکه','برای تکمیل دسترسی، پیام تعیین‌شده توسط مدیر شبکه را مشاهده کنید.','$(link-advert)','مشاهده پیام'),
      'api.json':r'''{"captive":$(if logged-in == 'yes')false$(else)true$(endif),"user-portal-url":"$(link-login-only)"}'''
    }
