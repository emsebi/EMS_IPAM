# گزارش تست v1.5.0-stage1-radio

## تست‌های اجراشده در زمان Build

- `node --check docker-app/server/main.mjs` — PASS
- `node --check docker-app/public/app.js` — PASS
- `node --check docker-app/public/mock-api.js` — PASS
- `bash -n install.sh` — PASS
- Parse فایل `compose.yml` — PASS
- Node test suite — **35/35 PASS**
- ZIP integrity — در Packaging نهایی بررسی می‌شود

## موارد پوشش‌داده‌شده توسط تست‌ها

- CIDR math از Root تا Detail
- `/30` = چهار IP و عدم نمایش `/31` در Detail table
- Company/IP/Scoped access schema
- User lifecycle و حفاظت Last Admin
- Module discovery و Module permissions
- Migration اصلاح‌شده Role constraint (`oid`)
- Persistent `.env` برای Docker Compose معمولی
- Backup اجباری قبل از Update و عدم حذف DB volume
- Rollback فایل Application در Fail شدن Update
- عدم ذخیره Password تجهیزات در Base/Radio
- Search / Inventory / Backup API
- Device Type قابل مدیریت + Inventory filtering/export
- Personnel import/export/navigation
- Language toggle + English default + Sidebar ثابت سمت چپ
- Radio AP/Station ساده و Sync با IPAM
- جداسازی Phone/Mobile/Email در نمایش Contact

## محدودیت محیط Build

Docker daemon واقعی در محیط ساخت در دسترس نیست؛ بنابراین اجرای واقعی `docker compose up` در این محیط قابل انجام نبود. تست‌های Syntax/Unit/Static انجام شده‌اند و Installer در Fail شدن Health Check لاگ App/DB را نمایش می‌دهد.
