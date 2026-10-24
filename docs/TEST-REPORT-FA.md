# گزارش تست — پنل 1.7.0-rc.3 / کلاینت 0.8.0

تاریخ جمع‌بندی: 2026-10-25 به وقت تهران. [گزارش انتشار](releases/v1.7.0-rc.3.md) مرجع محدودهٔ این نقطهٔ ذخیره است.

| بررسی | نتیجه |
|---|---|
| Core، منطق، قراردادها و دیتابیس PGlite | ۱۸۵ تست JavaScript موفق |
| RADIUS Ops، رابط RADIUS و پارسر نقشه | ۴۳ تست JavaScript موفق؛ شامل اصلاح مرزبندی رکورد LLDP |
| Chromium، مرورگر و API واقعی برنامه | ۱۵ سناریو موفق؛ دیتابیس موقت PGlite |
| RADIUS supervisor و تنظیم لاگ | ۳۰ + ۲ تست Python موفق در GitHub Actions |
| QRها و آدرس‌های حمایت مالی | checksum دو آدرس معتبر؛ هر دو QR با decoder مستقل به URI ارسالی مالک پروژه بازگشتند |
| Docker Build، PostgreSQL TCP و smoke FreeRADIUS | برای commit مبنای این نسخه در آزمایشگاه موفق؛ برای تغییرات rc.3 در محیط محلی Docker موجود نبود |
| Windows registry، انتخاب برنامهٔ مرورگر و WinBox واقعی | در این checkpoint دوباره اجرا نشده؛ پذیرش دستی روی Windows لازم است |
| کشف زندهٔ نقشه، MAC Trace و اعمال 802.1X/NAC | در محدودهٔ آمادهٔ این checkpoint نیستند |

## شواهد همین نسخه

- [CI موفق کد rc.3](https://github.com/emsebi/EMS_IPAM/actions/runs/40137314706) روی commit `99a4df1754ee72188e5b46a8a83da4aea2691c15`؛ commitهای بعدی انتشار، عکس‌ها و مستندات را ثبت می‌کنند.
- [unit-test.log](test-results/unit-test.log)، [module-test.log](test-results/module-test.log)، [browser-test.log](test-results/browser-test.log) و [browser-result.json](test-results/browser-result.json).
- تصاویر جدید IPAM، Device Types، Radio، RADIUS، Reports و About با دادهٔ آزمایشی؛ تصویر راهنمای کلاینت از صفحهٔ فعلی بدون تغییر محتوایی است.
- [استقرار و smoke موفق مبنا](https://github.com/emsebi/EMS_IPAM/actions/runs/39882213095) روی commit `2b889709064b01872f2d6ff33eeeb73b0f0a49da`؛ نتیجهٔ آن از تست کد rc.3 جداست.

سه تست مالکیت پورت UDP در محیط محدود محلی موفق نشدند؛ این تست‌ها و کنترل‌های سلامت تضعیف یا حذف نشدند و همان نسخه روی runner لینوکس GitHub کاملاً موفق شد.

## جریان‌های مرورگر

ورود و health؛ حفاظت API بدون ورود؛ ثبت Device Type؛ ساخت و ویرایش تجهیز با MAC/VLAN؛ منع IP تکراری؛ لینک MIK، مقصد قابل انتخاب، راهنمای کلاینت و دانلود ZIP؛ انتقال تغییرنام نوع و منع حذف نوع استفاده‌شده؛ AP و Station مرتبط و نمایش موبایل؛ MAC/پرسنل، ثبت فقط با نام، جست‌وجو و Export؛ RADIUS Client/Group/User و کانفیگ دستی؛ گزارش‌های خلاصه و حذف جزئیات حساس Audit؛ Settings؛ حمایت مالی در About؛ محدودیت کاربر Viewer؛ نبود خطای JavaScript مدیریت‌نشده.

بخش حمایت با هر دو آدرس، لینک کیف پول، بارگذاری QR، کپی واقعی، Clipboard API غایب، شکست کپی قدیمی و انتخاب دستی، فارسی/انگلیسی و عرض‌های ۳۹۰، ۶۰۰ و ۱۴۴۰ بررسی شده است. هیچ کیف پول خارجی باز و هیچ وجهی منتقل نشده است.

آزمون مرورگر Mock API نیست؛ سرور واقعی است ولی pg با آداپتور PGlite جایگزین می‌شود. خطاهای مجوز در embedded-server.log عمدی‌اند. برای تکرار: از docker-app، `npm ci` و `npm test`؛ سپس `npx playwright install chromium` و `npm run test:browser`. دستورات تست ماژول‌ها و Python در `.github/workflows/ci.yml` هستند.

## شواهد قبلی کلاینت ویندوز، بدون تغییر در این انتشار

کلاینت 0.8.0 همان بستهٔ قبلی است. در بررسی ثبت‌شدهٔ 2026-10-06، ۲۲ تست قابل‌حمل PowerShell موفق شدند و لانچر C# با مرجع Microsoft .NET Framework 4.8 کامپایل شد. [لاگ منطق کلاینت](test-results/client-logic-test.log) و [لاگ ساخت ویندوز](test-results/windows-build.log) مربوط به همان بررسی‌اند؛ کامپایل جای اجرای واقعی روی Windows را نمی‌گیرد.

Test.cmd در Windows علاوه بر ۲۲ تست منطق، ۴ بررسی عبور آرگومان از EXE به برنامهٔ ضبط‌کنندهٔ آزمایشی انجام می‌دهد. پذیرش محیط کاربر شامل نصب/ارتقا طبق README، تست Docker در VM، نصب کلاینت و Test.cmd، و یک MIK با پورت پیش‌فرض و یکی با پورت سفارشی است.
