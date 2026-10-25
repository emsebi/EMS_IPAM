# قرارداد فعلی ماژول‌ها — apiVersion 1

این قرارداد نسخه جاری است. استقلال همه بخش‌های قدیمی هنوز تکمیل نشده؛ رابط IPAM اصلی، Inventory و Personnel بخشی از Core هستند.

## پوشه‌ها و ورودی‌ها

هر ماژول در modules/<id> است. module.json شامل id، name، version، apiVersion: 1، enabled، permissions و در صورت داشتن کد سمت سرور backend: "backend/index.mjs" است. فایل backend باید createModule(ctx) برگرداند؛ خروجی آن match(req,url) و handle(req,res,url,user) دارد. نمونه اجرایی: modules/ipam/backend/index.mjs.

فایل‌های رابط در public قرار می‌گیرند و از /m/<id>/ ارائه می‌شوند. ماژول‌های همراه این نسخه createUi(ctx) دارند؛ Core آن‌ها را بارگذاری می‌کند و در صفحه پنل نمایش می‌دهد. نمونه: modules/radio/public/index.mjs. برای ماژول پنلی جدید کافی است در navigation مقدار `"panel": true` ثبت شود. برچسب منو می‌تواند بدون تغییر Core از `navigation.labels` بیاید، مثلاً `{"en":"RADIUS / AAA","fa":"RADIUS / AAA"}`؛ در نبود زبان جاری، `labels.en` و سپس `label` fallback است. `public/index.mjs` تابع `createUi(ctx)` با خروجی دارای `openPage({ routeParts, fromRoute })` ارائه کند؛ مسیر عمومی `#/module/<id>` بدون افزودن route اختصاصی به Core کار می‌کند. ماژول می‌تواند ترجمه‌های خودش را در `public/i18n/en.json` و فایل زبان‌های دیگر قرار دهد؛ English fallback است و اگر کلیدی در کاتالوگ ماژول نباشد، مترجم Core استفاده می‌شود.

ctx سمت سرور دسترسی به pool، json، readBody، پاک‌سازی/اعتبارسنجی، requireAdmin/requireModuleAccess، audit و broadcast دارد. احراز هویت و محافظت درخواست نوشتنی ابتدا در Core انجام می‌شود، ولی هر handler باید مجوز خودش را نیز کنترل کند. رشته‌های permissions متادیتا هستند؛ خودشان مجوز عملیاتی اجرا نمی‌کنند. backend به صورت کد مورداعتماد در همان پردازش Node اجرا می‌شود و Sandbox نیست.

## وضعیت ماژول‌های همراه

| پوشه | نسخه | آنچه واقعاً جدا شده |
|---|---|---|
| modules/ipam | 1.7.0-rc.2 | API و صفحه Device Types؛ سایر IPAM هنوز در Core |
| modules/radio | 2.0.0-rc.1 | UI AP/Station و Ping تکی؛ ذخیره رکورد در hosts مشترک |
| modules/network-access | 0.1.0-rc.1 | نمایش MACهای IPAM و تب پرسنل؛ هنوز بدون RADIUS/Discovery |
| modules/radius | 1.0.1-lab | رابط و API مدیریت RADIUS؛ سرویس اجرایی در radius-ops |
| modules/radius-ops | 1.0.1-lab | سرویس FreeRADIUS، جدول‌ها و migrationهای اختصاصی، Compose و تست‌های مستقل |
| modules/reports | 0.1.0-rc.1 | رابط و API گزارش‌های عملیاتی، کاتالوگ ترجمهٔ مستقل |
| modules/network-map | 0.1.0 | API Snapshot و پارسر آفلاین LLDP/CDP؛ کشف زنده و رابط پیشرفته هنوز در دست توسعه |

IPAM و Inventory دسترسی پایه داده‌های رادیو هستند؛ برای غیرمدیر باید هر سه مجوز به‌علاوه شرکت/رنج داده شوند. نقش‌های غیرمدیر فعلاً اطلاعات پایه را فقط می‌خوانند. API نسخه 1 بررسی می‌شود؛ سامانه حل خودکار وابستگی‌ها و حداقل نسخه Core هنوز وجود ندارد.

## جایگزینی همان ماژول

برای **تغییر فقط کد ماژول سازگار با همین Core**، پوشه جدید ماژول را خارج از محل اجرا آماده کنید؛ از پوشه قبلی کپی داشته باشید، app را در پنجره نگهداری متوقف کنید، همان پوشه را جایگزین و app را روشن کنید. مسیر modules به‌صورت read-only داخل کانتینر mount است؛ backend در startup بارگذاری می‌شود. برای این نوع تغییر rebuild image لازم نیست. تغییر version در module.json باعث تغییر آدرس cache رابط می‌شود. حذف modules/ipam مجاز نیست چون Device Types این نسخه به آن وابسته است.

اگر Core، dependency npm، Dockerfile یا schema تغییر کرد، بسته ارتقای مربوط و build/migration لازم است؛ فقط کپی‌کردن فولدر در این حالت کافی نیست. نصب نسخه فعلی شامل تغییر Core است، پس از install.sh گزینه Update استفاده کنید. ارتقای Core ماژول‌های اضافی غایب در بسته را حفظ می‌کند؛ ماژول هم‌نامِ همراه بسته جای نسخه موجود می‌نشیند، بنابراین تغییر محلی را قبل از ارتقا نگه دارید.

## دیتابیس و سرویس‌های آینده

schema_migrations baseline Core و migrationهای ماژول‌ها را با transaction، advisory lock و checksum ثبت می‌کند. schema.sql منتشرشده را تغییر ندهید؛ تغییر Core باید migration نسخه‌دار باشد. هر ماژول می‌تواند فایل‌های SQL خود را در `migrations/` با نامی مانند `001-radius-foundation.sql` نگه دارد. migrationهای هر ماژول در transaction جدا اجرا می‌شوند؛ اگر migration یک ماژول خراب باشد همان ماژول غیرفعال می‌شود و Core و ماژول‌های سالم می‌توانند بالا بیایند. فایل migration اعمال‌شده قابل ویرایش نیست و تغییر checksum باعث غیرفعال‌شدن ماژول می‌شود. مدل مشترک IP/شرکت/تجهیز باید با ID استفاده شود؛ Type و Owner قدیمی هنوز رشته‌اند و نیازمند مهاجرت تدریجی‌اند.

compose.module.yml برای سرویس جداگانه اختیاری است و نصب‌کننده آن را با Compose اصلی ترکیب می‌کند. مدل enable/disable این سرویس‌ها هنوز چرخه مدیریت مستقل کامل ندارد؛ صرف enabled:false در manifest توقف کانتینر نیست. RADIUS و worker کشف در پارت مربوط با health، نسخه و تست سازگاری خود تحویل می‌شوند.

## قاعدهٔ توسعه بعد از checkpoint نسخهٔ 1.7.0-rc.3

- منطق هر قابلیت جدید در `modules/<id>` قرار می‌گیرد: manifest، backend، public، ترجمه، migration و تست‌های همان ماژول.
- ثبت منو و مسیر با `navigation.panel: true` و `#/module/<id>` انجام می‌شود؛ افزودن ID جدید به لیست ثابت Core لازم نیست. احراز هویت، دسترسی و بارگذاری مشترک در Core می‌مانند.
- مدل‌های مشترک شرکت، IP و تجهیز با ID استفاده می‌شوند. یک ماژول نباید کد یا migration ماژول دیگر را به‌صورت پنهان تغییر دهد؛ نیاز به قرارداد تازه باید جدا مستند و تست شود.
- قابلیت جدیدی که قرارداد apiVersion 1 پوشش می‌دهد، نباید route یا صفحهٔ اختصاصی جدید داخل `server/main.mjs` یا `public/app.js` ایجاد کند. تغییر هسته فقط برای قابلیت مشترک یا اصلاح قرارداد لازم است و جدا ثبت می‌شود.
- خطای import یا migration یک ماژول هنگام شروع جدا مدیریت می‌شود، اما ماژول‌ها داخل یک پردازش اجرا می‌شوند؛ جداسازی کامل خرابی/مصرف CPU یا Sandbox وجود ندارد.
- IPAM قدیمی، Inventory و Personnel هنوز کاملاً مستقل نیستند. استخراج آن‌ها مرحله‌ای انجام می‌شود؛ این checkpoint بازنویسی آن‌ها را ادعا نمی‌کند.
- وابستگی‌های npm جدید ممکن است نیاز به build داشته باشند. افزودن سرویس مستقل نیازمند `compose.module.yml` و اجرای Compose است؛ صرف کپی پوشه برای همهٔ تغییرها کافی نیست.

پوشش موجود در تست‌ها: ثبت منو، مسیر عمومی پنل، ترجمهٔ مستقل، کنترل دسترسی، checksum و transaction مهاجرت‌ها، و ادامهٔ کار Core پس از migration ناموفق ماژول.
