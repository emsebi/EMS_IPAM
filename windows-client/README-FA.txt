EMS-IPAM Windows Client 0.8.0

نصب یا ارتقا:
1. همه فایل‌های ZIP را استخراج کنید.
2. Install.cmd را با همان کاربر ویندوز اجرا کنید؛ Run as administrator لازم نیست.
3. Configure-WinBox.cmd را اجرا و فایل واقعی WinBox را انتخاب کنید.
4. در پنل MIK را بزنید. مرورگر باید EMS-IPAM Client را باز کند.

این نسخه لانچر آمادهٔ EMS-IPAM-Client.exe را از ZIP در مسیر زیر نصب می‌کند:
%LOCALAPPDATA%\EMS-IPAM-Client\EMS-IPAM-Client.exe
Windows PowerShell 5.1 و .NET Framework 4.8 ویندوز برای اجرا استفاده می‌شوند؛ SDK یا کامپایل هنگام نصب لازم نیست. سورس C# و Build-EMS-Client.ps1 هم برای توسعه‌دهنده همراه بسته‌اند.

رفع مشکل تصویر شما (لینک کامل داخل Connect To):
اگر در مرورگر WinBox را انتخاب کرده‌اید، آن انتخاب باید عوض شود.
Firefox: Settings > General > Applications > emsipam-client > Use other
در انتخاب فایل، مسیر بالا را وارد کنید و EMS-IPAM-Client.exe را انتخاب کنید.
اگر Applications هنوز این پروتکل را ندارد، دوباره روی MIK کلیک و همین برنامه را معرفی کنید.
Windows/Chrome/Edge: Settings > Apps > Default apps، پروتکل emsipam-client را به EMS-IPAM Client بدهید.
Repair.cmd ثبت برنامه را ترمیم می‌کند ولی انتخاب ذخیره‌شده مرورگر را بازنویسی نمی‌کند.
انتخاب فایل WinBox داخل پنجره EMS-IPAM انجام می‌شود، انتخاب برنامه مرورگر EMS-IPAM Client است.

تست:
Test.cmd: تست آفلاین اعتبارسنجی و عبور آرگومان از لانچر به یک برنامه ضبط‌کننده آزمایشی؛ به دستگاهی وصل نمی‌شود.
Check.cmd: نسخه، مسیر پروتکل، انتخاب پیش‌فرض ویندوز و آخرین اجرا.
آخرین اجرا: %LOCALAPPDATA%\EMS-IPAM-Client\last-launch.txt
مثال: MIK / 192.168.1.4 / 8291 باید فقط 192.168.1.4 را به WinBox بدهد.
پورت سفارشی 9191: مقصد 192.168.1.4:9191 است. برای IPv6 براکت استفاده می‌شود.
اگر زمان آخرین اجرا پس از کلیک تغییر نکرد، مرورگر به این کلاینت نمی‌رسد.
خطاهای اجرا پیام قابل مشاهده دارند. مسیرهای ابزار انتخاب‌شده هنگام نصب مجدد حفظ می‌شوند.

ابزارها: WinBox، Remote Desktop، PuTTY/OpenSSH، Telnet و VNC.
IP، پورت و نام کاربری اختیاری منتقل می‌شوند؛ رمز در لینک نیست.
برای حذف ثبت پروتکل، Uninstall-EMS-Client.ps1 را اجرا کنید. تنظیمات ابزار برای استفاده بعدی حفظ می‌شوند.

وضعیت اعتبارسنجی این تحویل: اجرای Windows/WinBox در محیط سازنده در دسترس نبوده؛ Test.cmd و تست مرورگر روی ویندوز شما مرحله پذیرش هستند.
طراح پروژه: ابراهیم مامانی — https://github.com/emsebi/EMS_IPAM
