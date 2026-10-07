# گزارش تست — پنل 1.7.0-rc.2 / کلاینت 0.8.0

تاریخ جمع‌بندی: 2026-10-06. لاگ‌ها و تصاویر همراه همین سورس‌اند.

| بررسی | نتیجه |
|---|---|
| Node 24.19، منطق، قراردادها و دیتابیس PGlite | ۶۰ تست پاس؛ بدون Fail یا Skip |
| Chromium 153، مرورگر و API واقعی برنامه | ۱۱ سناریو پاس؛ دیتابیس موقت PGlite |
| منطق کلاینت در PowerShell 7.4.6 روی Linux | ۲۲ تست پاس؛ از جمله IP پیش‌فرض، پورت سفارشی، IPv6، ابزارها و ورودی نامعتبر |
| لانچر C# ویندوز | با اسمبلی‌های مرجع Microsoft .NET Framework 4.8 کامپایل شد؛ PE ویندوز در ZIP موجود است |
| نحو PowerShell، Bash و JavaScript | بررسی شده |
| نصب فایل و ورودی استاندارد، مسیر پیش‌نیاز و رد آرشیو خراب | در تست ایزوله با جایگزین عملیات سیستم پاس شده؛ نصب واقعی Docker نیست |
| Windows registry، انتخاب برنامهٔ مرورگر و WinBox واقعی | در محیط ساخت اجرا نشده؛ Test.cmd و پذیرش دستی لازم است |
| Docker Build، PostgreSQL TCP، pg_dump/restore واقعی | اجرا نشده؛ scripts/docker-release-smoke.sh برای VM آزمایشی آماده است |
| Cisco/MikroTik زنده، کارایی ۱۰۰–۵۰۰ دستگاه و ارتقای سرتاسری | هنوز اجرا نشده |

## جریان‌های مرورگر

ورود و health؛ حفاظت API بدون ورود؛ ثبت Device Type؛ ساخت و ویرایش تجهیز با MAC/VLAN؛ لینک MIK، مقصد قابل انتخاب، راهنمای کلاینت و دانلود ZIP؛ انتقال تغییرنام نوع و منع حذف نوع استفاده‌شده؛ AP و Station مرتبط، نمایش موبایل؛ تب MAC/پرسنل، ثبت فقط با نام، جست‌وجو و Export؛ Settings؛ محدودیت کاربر Viewer؛ نبود خطای JavaScript مدیریت‌نشده. تصویر IPAM نیز از صفحه واقعی داده آزمایشی گرفته شده است.

## کلاینت

Test.cmd در ویندوز ۲۲ تست منطق و ۴ بررسی عبور واقعی آرگومان از EXE به برنامهٔ ضبط‌کنندهٔ آزمایشی انجام می‌دهد؛ مجموعاً ۲۶ بررسی، بدون اتصال به تجهیزات. در محیط ساخت فقط ۲۲ تست قابل‌حمل اجرا شده‌اند. کامپایل موفق، جای اجرای واقعی روی ویندوز را نمی‌گیرد.

## شواهد

- test-results/unit-test.log
- test-results/browser-test.log و browser-result.json
- test-results/client-logic-test.log و windows-build.log
- test-results/syntax-check.log و packaging-check.log
- تصاویر ipam، device-types، radios، client-connection و client-guide

آزمون مرورگر Mock API نیست؛ سرور واقعی است ولی pg با آداپتور PGlite جایگزین شده. خطاهای 403 عمدی در embedded-server.log مربوط به تست مجوزها هستند. برای تکرار: از docker-app، `npm ci` و `npm test`؛ سپس `npx playwright install chromium` و `npm run test:browser`.

## پذیرش روی ماشین کاربر

نصب/ارتقا با راهنمای README، اجرای اسکریپت Docker smoke در VM، نصب کلاینت و Test.cmd، سپس یک MIK با پورت پیش‌فرض و یک پورت سفارشی. انتظار پورت 8291 فقط IP است. schema.sql نسبت به RC1 تغییر نکرده و این اصلاحات مهاجرت دادهٔ جدید ندارند. نتیجه پذیرش در CONTINUATION.md ثبت می‌شود و تحویل بعدی ماژول RADIUS کارشناسان است.
