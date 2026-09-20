# گزارش تست v1.4.0-stage1

## تست‌های اجراشده در زمان Build

- `node --check docker-app/server/main.mjs` — PASS
- `node --check docker-app/public/app.js` — PASS
- `node --check docker-app/public/mock-api.js` — PASS
- `bash -n install.sh` — PASS
- Node test suite — 27/27 PASS
- ZIP integrity — در زمان Packaging بررسی می‌شود

## موارد پوشش‌داده‌شده توسط تست‌ها

- CIDR math از Root تا Detail
- `/30` = چهار IP و عدم نمایش `/31` در Detail table
- Company/IP/Scoped access schema
- User lifecycle و حفاظت Last Admin
- Module discovery
- Module permissions schema
- Backup قبل از Update
- Rollback فایل Application
- عدم ذخیره Password تجهیزات
- Search / Inventory / Backup API
- Frontend IDs و Workflowهای اصلی

## محدودیت محیط Build

Docker daemon واقعی در محیط ساخت در دسترس نیست؛ بنابراین اجرای `docker compose up` باید روی Ubuntu تست کاربر انجام شود. Installer در Fail شدن Health Check لاگ App/DB را نمایش می‌دهد.
