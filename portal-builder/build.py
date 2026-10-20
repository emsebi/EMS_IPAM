"""Build a private RouterOS portal. Never print organization data or source URLs."""
from pathlib import Path
import json, subprocess, sys, urllib.request, urllib.parse, hashlib, re, threading, functools, http.server, shutil, os
import pyzipper
import templates

ROOT = Path.home()/'.cache'/'hotspot-template-20261020'
HERE = Path(__file__).resolve().parent
STAGE = 'initialization'
checks = []
def check(value, name):
    if not value:
        raise AssertionError(name)
    checks.append(name)
def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
def render(source, env):
    active = True
    stack = []
    out = []
    def truth(expr):
        match = re.fullmatch(r"([\w-]+)\s*==\s*['\"](.*?)['\"]", expr)
        if match: return str(env.get(match[1], '')) == match[2]
        return bool(env.get(expr.strip(), ''))
    for part in re.split(r'(\$\([^)]*\))', source):
        if not part.startswith('$('):
            if active: out.append(part)
            continue
        key=part[2:-1].strip()
        if key.startswith('if '):
            value=truth(key[3:])
            stack.append([active, value])
            active=active and value
        elif key.startswith('elif '):
            parent,seen=stack[-1]
            value=not seen and truth(key[5:])
            stack[-1][1]=seen or value
            active=parent and value
        elif key=='else':
            parent,seen=stack[-1]
            active=parent and not seen
            stack[-1][1]=True
        elif key=='endif':
            active=stack.pop()[0]
        elif active:
            if key.endswith('-esc'):
                out.append(urllib.parse.quote(str(env.get(key[:-4],'')),safe=''))
            else:
                out.append(str(env.get(key,'')))
    if stack: raise ValueError('Unbalanced template conditions')
    return ''.join(out)
def env(**overrides):
    data={'username':'همکار گرامی','ip':'192.0.2.25','mac':'00:11:22:33:44:55','uptime':'1h 24m',
      'bytes-in-nice':'24.6 MiB','bytes-out-nice':'185.2 MiB','session-time-left':'6h 36m',
      'trial':'yes','login-by':'http-chap','logged-in':'yes','error':'','chap-id':'','chap-challenge':'',
      'link-login-only':'login.html','link-login':'login.html','link-status':'status.html',
      'link-logout':'logout.html','link-redirect':'login.html','link-advert':'login.html'}
    data.update(overrides)
    return data
def simulation(text, data, preview=False):
    rendered=render(text,data).replace('src="assets/','src="../hotspot-portal/assets/').replace('href="assets/','href="../hotspot-portal/assets/')
    if preview:
        rendered=rendered.replace('<body>','<body data-preview><div class="preview-banner">پیش‌نمایش طراحی · اطلاعات اتصال نمایشی است</div>')
    return rendered

def documentation(p, sizes, tested):
    rows='\n'.join('| '+a['name']+' | '+a['url']+' | '+('داخلی' if a['internal'] else 'تحت وب')+' |' for a in p['apps'])
    return f'''# راهنمای نصب پرتال {p['brand']}

این بسته از ابتدا برای شرکت ساخته شده است. لوگو، فونت و فایل استاندارد CHAP از پوشهٔ مرجع دریافتی نگه داشته شده‌اند. آدرس هر هفت سامانه عین فایل مرجع است. تصاویر حجیم، فونت‌های تکراری و فایل‌های مربوط به طرح‌های دیگر در خروجی نیستند.

## محتویات
- hotspot-portal: فقط فایل‌هایی که باید روی روتر قرار بگیرند.
- preview: پیش‌نمایش نمایشی؛ برای دیدن ظاهر، login.html یا status.html را در مرورگر باز کنید. این پوشه روی روتر لازم نیست.
- QA-FA.md: نتیجهٔ آزمون‌های خودکار و محدودیت‌های تأیید.
- این راهنما و گزارش را روی روتر آپلود نکنید.

## نصب
۱. از پوشهٔ HotSpot فعلی و تنظیمات روتر نسخهٔ پشتیبان بگیرید.
۲. پوشهٔ hotspot-portal را با زیرپوشهٔ assets در Files روتر آپلود کنید. در دستگاه‌های دارای flash، فایل‌ها را در مسیر ماندگار مناسب همان دستگاه قرار دهید.
۳. در IP → Hotspot → Server Profiles، پروفایلی را که HotSpot موردنظر استفاده می‌کند باز کنید و HTML Directory را به مسیر دقیق پوشهٔ آپلودشده تغییر دهید؛ مثلاً hotspot-portal یا flash/hotspot-portal، مطابق Files روتر. نام پروفایل و مسیر را حدس نزنید. اگر HTML Directory Override فعال است، مؤثر بودن آن را هم بررسی کنید.
۴. از دستگاهی با نشست تازه، ورود حساب واقعی، نمایش داشبورد، قطع اینترنت و ورود مجدد را امتحان کنید.
۵. برای برگشت، HTML Directory را به پوشهٔ قبلی برگردانید. این بسته هیچ تنظیم شبکه‌ای را خودکار تغییر نمی‌دهد.

## ورود میهمان (Trial)
در پروفایل مربوط به HotSpot، در بخش Login، گزینهٔ Trial را فعال کنید. شرایط نمایش لینک دقیقاً شرط بومی RouterOS است:

    $(if trial == 'yes')
    ورود کاربر میهمان
    $(endif)

لینک با نام کاربری T- به‌همراه MAC و مقصد صفحهٔ status ارسال می‌شود. مدت Trial، فاصلهٔ مجاز استفادهٔ دوباره و Trial User Profile را روی روتر تنظیم کنید. پس از تمام‌شدن سهمیهٔ Trial، ممکن است لینک حتی با فعال بودن تیک نمایش داده نشود؛ RouterOS وضعیت مجاز بودن دستگاه را تعیین می‌کند. طرح برای Trial فعال، غیرفعال و نشست میهمان بررسی شده است.

## رفتار صفحات
- login: نام کاربری و رمز، نمایش رمز، خطاهای متداول فارسی، CHAP/PAP مطابق تنظیم روتر و لینک مشروط میهمان.
- status: داشبورد کامل، ۷ سامانه، جست‌وجو، دسته‌بندی، علاقه‌مندی‌ها، IP، مدت اتصال، حجم دریافت و ارسال و دکمهٔ قطع اینترنت.
- logout: داشبورد همان ۷ سامانه همراه با ورود مجدد. قطع اینترنت با POST و erase-cookie=on انجام می‌شود.
- fstatus و flogout: داشبورد حالت بدون نشست.
- alogin و rstatus: انتقال به داشبورد status.
- rlogin، redirect، error و radvert: صفحات سازگار و هماهنگ با هویت بصری.
- api.json: پاسخ حداقلی وضعیت captive برای قابلیت تشخیص پرتال RouterOS جدید. فعال‌بودن تشخیص خودکار پرتال به نسخه و DNS/TLS و تنظیمات دستگاه هم وابسته است.

آمار نشست با دکمهٔ به‌روزرسانی تازه می‌شود. فعال‌بودن نشست، به‌تنهایی به معنی سالم‌بودن مسیر اینترنت بالادست نیست. در حالت خروج، دسترسی اینترنتی قطع است و قالب مجوز شبکه ایجاد نمی‌کند. روش‌های ورود و RADIUS از تنظیمات فعلی روتر پیروی می‌کنند. برای PAP باید تنظیم امن HTTPS شبکه رعایت شده باشد؛ قالب TLS را ایجاد نمی‌کند.

## سامانه‌ها
| سامانه | نشانی مرجع | نوع |
| --- | --- | --- |
{rows}

## دسترسی به سامانه‌ها بعد از خروج
اگر کاربر باید بدون ورود به اینترنت، سامانه‌ای را باز کند، مدیر شبکه باید همان مقصد و پورت لازم را در Walled Garden و در صورت نیاز Walled Garden IP و قواعد شبکه مجاز کند. برای سامانه‌های داخلی، مقصد IP و پورت واقعی جدول بالا را بررسی کنید؛ لینک‌های بدون پورت صریح از پورت پیش‌فرض HTTP/HTTPS استفاده می‌کنند. سرویس‌های تحت وب ممکن است دامنهٔ ورود یا وابستگی دیگری داشته باشند؛ فقط موارد تأییدشده را باز کنید. از بازکردن کلی شبکه یا همهٔ HTTPS برای حل این موضوع استفاده نکنید. نمایش لینک در داشبورد به معنی داشتن مجوز دسترسی نیست.

## ظاهر و حریم خصوصی
RTL، فونت محلی، لوگوی اصلی، طراحی واکنش‌گرا برای موبایل و دسکتاپ، انیمیشن‌های سادهٔ CSS و رعایت prefers-reduced-motion. هیچ CDN، آمارگیر یا درخواست بیرونی برای بارگذاری ظاهر وجود ندارد. فقط شناسهٔ علاقه‌مندی‌ها در مرورگر ذخیره می‌شود؛ نام کاربری و رمز ذخیره نمی‌شوند. محدودیت مرورگرهای Captive Portal ممکن است بازشدن سامانه در زبانهٔ جدا را تغییر دهد؛ در این حالت از مرورگر کامل دستگاه استفاده کنید.

اندازهٔ کل فایل‌های مخصوص روتر: {sizes['router_bytes']:,} بایت.
تعداد فایل‌های مخصوص روتر: {sizes['router_files']}.

## منابع رسمی
- https://manual.mikrotik.com/docs/authentication-authorization-accounting/hotspot-captive-portal/hotspot-customisation/
- https://manual.mikrotik.com/docs/authentication-authorization-accounting/hotspot-captive-portal/
- https://help.mikrotik.com/docs/spaces/ROS/pages/56459266/HotSpot%2B-%2BCaptive%2Bportal

## تأیید نهایی روی شبکه
در این محیط به RouterOS واقعی شرکت دسترسی وجود نداشت. آزمون نهایی باید روی روتر خودتان انجام شود: حساب معتبر و نامعتبر، Trial دستگاه تازه و دستگاه با سهمیهٔ تمام‌شده، تغییر مسیر پس از ورود، قطع واقعی نشست و cookie، لینک‌های داخلی/خارجی و Walled Garden. پیش‌نمایش شبیه‌سازی است و به اینترنت واقعی وصل یا از آن قطع نمی‌کند.
'''

def main():
    global STAGE
    STAGE='decrypt'
    encrypted=json.loads((HERE/'payload.json').read_text())
    chunks=[]
    for block in encrypted['blocks']:
        result=subprocess.run(['openssl','pkeyutl','-decrypt','-inkey',str(ROOT/'private.pem'),
          '-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256','-pkeyopt','rsa_mgf1_md:sha256'],
          input=bytes.fromhex(block),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=True)
        chunks.append(result.stdout)
    p=json.loads(b''.join(chunks))
    check(p['version']==1 and len(p['apps'])==7, 'private configuration')
    STAGE='assets'
    work=ROOT/'build'
    if work.exists(): shutil.rmtree(work)
    work.mkdir(mode=0o700)
    router=work/'hotspot-portal'
    router.mkdir()
    for asset in p['sources']:
        parsed=urllib.parse.urlsplit(asset['url'])
        check(parsed.scheme=='https' and parsed.hostname.endswith('.oaiusercontent.com'), 'source host allowlist')
        dest=router/asset['path']
        check(dest.parent == router/'assets', 'asset destination')
        data=urllib.request.urlopen(asset['url'],timeout=60).read(1000000)
        check(len(data)==asset['size'], 'source size')
        if dest.suffix=='.webp': check(data[:4]==b'RIFF' and data[8:12]==b'WEBP','logo format')
        if dest.suffix=='.woff2': check(data[:4]==b'wOF2','font format')
        if dest.suffix=='.js': check(b'hexMD5' in data,'CHAP library')
        dest.parent.mkdir(exist_ok=True)
        dest.write_bytes(data)
    STAGE='templates'
    source_pages=templates.pages(p)
    for name,source in source_pages.items(): write(router/name,source)
    shutil.copyfile(HERE/'portal.css',router/'assets'/'portal.css')
    shutil.copyfile(HERE/'portal.js',router/'assets'/'portal.js')
    # Every generated page must parse with and without optional RouterOS values.
    for name,source in source_pages.items():
        for values in [env(),env(trial='no',error='',uptime='',**{'chap-id':'','session-time-left':'','login-by':'trial'})]:
            check('$(' not in render(source,values),'resolved template '+name)
    check("$(if trial == 'yes')" in source_pages['login.html'],'native trial condition')
    check('username=T-$(mac-esc)' in source_pages['login.html'],'native trial identity')
    check('dst=$(link-status-esc)' in source_pages['login.html'],'trial destination')
    check('value="$(link-status)"' in source_pages['login.html'],'login destination')
    check('method="post"' in source_pages['status.html'] and 'name="erase-cookie" value="on"' in source_pages['status.html'],'logout contract')
    check('$(bytes-out-nice)' in source_pages['status.html'] and '$(bytes-in-nice)' not in source_pages['logout.html'],'page variable scope')
    check(json.loads(render(source_pages['api.json'],env()))['captive'] is False,'API active')
    check(json.loads(render(source_pages['api.json'],env(**{'logged-in':'no'})))['captive'] is True,'API captive')
    preview=work/'preview'
    for name in ['login.html','status.html','logout.html']:
        write(preview/name,simulation(source_pages[name],env(),True))
    write(preview/'guest.html',simulation(source_pages['status.html'],env(**{'login-by':'trial'}),True))
    write(preview/'login-no-trial.html',simulation(source_pages['login.html'],env(trial='no'),True))
    write(preview/'login-error.html',simulation(source_pages['login.html'],env(error='invalid username or password'),True))
    write(preview/'index.html','<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=status.html"><title>پیش‌نمایش</title><a href="status.html">مشاهدهٔ داشبورد</a></html>')
    qa=work/'qa'
    scenario={
      'login-yes.html':('login.html',env()),
      'login-no.html':('login.html',env(trial='no')),
      'login-empty.html':('login.html',env(trial='')),
      'login-chap.html':('login.html',env(**{'chap-id':r'\001','chap-challenge':r'\002\003\004\005'})),
      'login-error.html':('login.html',env(error='invalid username or password')),
      'login-unsafe-error.html':('login.html',env(error='<img src=x onerror="window.unsafe=true">')),
      'status.html':('status.html',env()),
      'guest.html':('status.html',env(**{'login-by':'trial'})),
      'logout.html':('logout.html',env()),
      'fstatus.html':('fstatus.html',env(uptime='')),
      'flogout.html':('flogout.html',env(uptime='')),
      'unsafe-name.html':('status.html',env(username='<img src=x onerror="window.unsafe=true">')),
      'error.html':('error.html',env(error='RADIUS server is not responding'))
    }
    for name,(src,values) in scenario.items(): write(qa/name,simulation(source_pages[src],values))
    STAGE='browser verification'
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args): pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(work)))
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    base='http://127.0.0.1:'+str(server.server_address[1])
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
            context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
            page=context.new_page()
            js_errors=[]
            external=[]
            failed=[]
            page.on('pageerror',lambda error:js_errors.append(type(error).__name__))
            page.on('request',lambda request:external.append(True) if not request.url.startswith(base) else None)
            page.on('response',lambda response:failed.append(response.status) if response.status>=400 else None)
            for width in [1440,768,390,360]:
                page.set_viewport_size({'width':width,'height':900})
                for name in ['login-yes.html','status.html','logout.html','fstatus.html','flogout.html','error.html']:
                    page.goto(base+'/qa/'+name)
                    page.evaluate('document.fonts.ready')
                    check(page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'), 'responsive '+str(width)+' '+name)
                    check(page.locator('.brand img').evaluate('(x)=>x.complete&&x.naturalWidth>0'),'logo decoded')
                    if name in ['status.html','logout.html','fstatus.html','flogout.html']:
                        links=page.locator('.service-card>a').evaluate_all('(els)=>els.map(x=>x.getAttribute("href"))')
                        check(links==[a['url'] for a in p['apps']],'dashboard destinations')
            page.set_viewport_size({'width':1440,'height':1000})
            page.goto(base+'/qa/login-yes.html')
            check(page.locator('[data-trial]').count()==1,'trial visible when eligible')
            query=urllib.parse.parse_qs(urllib.parse.urlsplit(page.locator('[data-trial]').get_attribute('href')).query)
            check(query['username']==['T-00:11:22:33:44:55'] and query['dst']==['status.html'],'trial query decoded')
            for name in ['login-no.html','login-empty.html']:
                page.goto(base+'/qa/'+name)
                check(page.locator('[data-trial]').count()==0,'trial hidden when unavailable')
            page.goto(base+'/qa/guest.html')
            check('کاربر میهمان' in page.locator('h1').inner_text(),'guest greeting')
            page.goto(base+'/qa/login-yes.html')
            page.locator('[data-toggle-password]').click()
            check(page.locator('#password').get_attribute('type')=='text','show password')
            page.locator('[data-toggle-password]').click()
            check(page.locator('#password').get_attribute('type')=='password','hide password')
            page.locator('#username').fill('employee')
            page.locator('#password').fill('secret')
            values=page.locator('form[name=login]').evaluate('(f)=>Object.fromEntries(new FormData(f))')
            check(values['username']=='employee' and values['password']=='secret' and values['dst']=='status.html','native PAP form')
            page.goto(base+'/qa/login-chap.html')
            chap=page.evaluate("""()=>{document.forms.login.elements.username.value='employee';document.forms.login.elements.password.value='secret';let sent=null;document.forms.sendin.submit=()=>{sent=Object.fromEntries(new FormData(document.forms.sendin));};let returned=doLogin();return {sent,returned};}""")
            expected=hashlib.md5(b'\x01secret\x02\x03\x04\x05').hexdigest()
            check(chap['returned'] is False and chap['sent']['password']==expected and chap['sent']['password']!='secret','CHAP hash')
            check(chap['sent']['dst']=='status.html' and chap['sent']['popup']=='false','CHAP destination')
            page.goto(base+'/qa/login-error.html')
            check('صحیح نیست' in page.locator('[data-error]').inner_text(),'localized login error')
            for name in ['login-unsafe-error.html','unsafe-name.html']:
                page.goto(base+'/qa/'+name)
                check(not page.evaluate('Boolean(window.unsafe)'),'dynamic text safety')
                check(page.locator('img').count()==1,'no injected HTML')
            page.goto(base+'/qa/status.html')
            page.locator('#app-search').fill(p['apps'][5]['name'])
            check(page.locator('[data-app]:visible').count()==1,'search')
            page.locator('#app-search').fill('')
            page.locator('[data-filter=operations]').click()
            check(page.locator('[data-app]:visible').count()==sum(a['category']=='operations' for a in p['apps']),'category filter')
            page.locator('[data-filter=all]').click()
            page.locator('[data-app="0"] .favorite').click()
            page.locator('[data-filter=favorites]').click()
            check(page.locator('[data-app]:visible').count()==1,'favorite selection')
            page.goto(base+'/qa/logout.html')
            page.locator('[data-filter=favorites]').click()
            check(page.locator('[data-app]:visible').count()==1,'favorites persist across dashboards')
            page.locator('[data-filter=all]').click()
            check(page.locator('.orbit').evaluate('(x)=>getComputedStyle(x).animationName')=='none','reduced motion')
            check(page.locator('a[href="login.html"]').count()>=1,'reconnect action')
            page.goto(base+'/qa/status.html')
            logout=page.locator('form').evaluate('(f)=>({method:f.method,action:f.getAttribute("action"),fields:Object.fromEntries(new FormData(f))})')
            check(logout=={'method':'post','action':'logout.html','fields':{'erase-cookie':'on'}},'logout submission')
            nojs=browser.new_context(java_script_enabled=False,viewport={'width':390,'height':844})
            nojs_page=nojs.new_page()
            for name in ['status.html','logout.html']:
                nojs_page.goto(base+'/qa/'+name)
                check(nojs_page.locator('.service-card>a:visible').count()==7,'no-JS application access')
            nojs.close()
            page.goto(base+'/preview/login.html')
            page.locator('#username').fill('preview')
            page.locator('#password').fill('preview')
            page.locator('.login-submit').click()
            page.wait_for_url('**/preview/status.html')
            check(page.locator('.service-card>a').count()==7,'preview login route')
            page.locator('.danger').click()
            page.wait_for_url('**/preview/logout.html')
            check(page.locator('.service-card>a').count()==7,'preview logout route')
            page.goto(base+'/preview/login.html')
            page.locator('[data-trial]').click()
            page.wait_for_url('**/preview/guest.html')
            check('کاربر میهمان' in page.locator('h1').inner_text(),'preview guest route')
            check(not js_errors,'no JavaScript errors')
            check(not external,'no external render requests')
            check(not failed,'no missing assets')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    STAGE='documentation'
    files=list(router.rglob('*'))
    sizes={'router_files':sum(f.is_file() for f in files),'router_bytes':sum(f.stat().st_size for f in files if f.is_file())}
    write(work/'README-FA.md',documentation(p,sizes,checks))
    hashes='\n'.join('- '+a['path']+': '+hashlib.sha256((router/a['path']).read_bytes()).hexdigest() for a in p['sources'])
    write(work/'QA-FA.md',f'''# گزارش بررسی پرتال
ساخت در محیط ایزولهٔ ورکر و آزمون با Chromium انجام شد.
تعداد کنترل‌های موفق: {len(checks)}.

موارد تأییدشده:
- تجزیهٔ تمام شرط‌ها و متغیرهای قالب در شبیه‌ساز RouterOS.
- Trial مجاز، غیرمجاز/غیرفعال، پنهان‌شدن لینک و نمایش هویت میهمان.
- ساخت لینک بومی Trial با مقصد status.
- فرم PAP و هش CHAP با چالش معلوم و مقایسه با hashlib.
- مقصد status پس از ورود و POST خروج همراه erase-cookie.
- هفت لینک صحیح در status، logout، fstatus و flogout.
- عرض‌های ۳۶۰، ۳۹۰، ۷۶۸ و ۱۴۴۰ پیکسل بدون اسکرول افقی.
- بارگذاری لوگوی اصلی و فونت محلی.
- جست‌وجو، فیلتر، علاقه‌مندی‌های پایدار و نمایش/پنهان‌کردن رمز.
- دسترسی به لینک‌ها بدون JavaScript، خطاهای فارسی و درج امن نام کاربر و متن خطا.
- کاهش انیمیشن با تنظیم سیستم و صفر درخواست خارجی برای رندر و صفر خطای JavaScript.
- گردش ورود، خروج و میهمان در پیش‌نمایش.
- رمزگذاری AES-256 و بازخوانی تمام فایل‌های بسته با تطابق بایت‌ها.

محدودیت: این بررسی شامل مشاهدهٔ مستقیم روی RouterOS واقعی، قطع اتصال واقعی یا تأیید دسترسی و احراز هویت سامانه‌های شرکت نیست. این موارد و Walled Garden باید در شبکهٔ شرکت آزموده شوند. اندازهٔ فایل‌ها در README آمده است.

## اثر انگشت فایل‌های مرجع بدون تغییر
{hashes}
''')
    STAGE='encrypted packaging'
    output=HERE/'output'
    output.mkdir(exist_ok=True)
    archive=output/'hotspot-template.zip'
    chosen=[f for f in work.rglob('*') if f.is_file() and f.relative_to(work).parts[0]!='qa']
    with pyzipper.AESZipFile(archive,'w',compression=pyzipper.ZIP_DEFLATED,encryption=pyzipper.WZ_AES) as z:
        z.setpassword(p['password'].encode('ascii'))
        z.setencryption(pyzipper.WZ_AES,nbits=256)
        for f in sorted(chosen): z.write(f,str(f.relative_to(work)))
    with pyzipper.AESZipFile(archive) as z:
        z.setpassword(p['password'].encode('ascii'))
        for f in chosen: check(z.read(str(f.relative_to(work)))==f.read_bytes(),'archive roundtrip')
    print(json.dumps({'result':'PASS','checks':len(checks),'router_files':sizes['router_files'],'router_bytes':sizes['router_bytes'],'archive_bytes':archive.stat().st_size,'packaged_files':len(chosen)}))
if __name__=='__main__':
    try: main()
    except Exception as failure:
        print('BUILD_FAILED stage='+STAGE+' type='+type(failure).__name__)
        if isinstance(failure,AssertionError): print('CHECK_FAILED '+str(failure))
        sys.exit(1)
