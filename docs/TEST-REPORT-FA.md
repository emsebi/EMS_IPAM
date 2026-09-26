# گزارش تست EMS IPAM v1.6.1

## نتیجه تست‌های اجراشده

- `npm ci` از روی Lockfile — PASS
- Node test suite — **54/54 PASS**
- اجرای Schema روی PostgreSQL سازگار (PGlite) — PASS
- اجرای دوباره Schema روی همان دیتابیس (Idempotency) — PASS
- Migration نقش قدیمی `editor` به `support` و ثبت نقش `branch` — PASS
- `node --check` برای Server، App و Mock API — PASS
- `bash -n` برای Installer و Docker smoke test — PASS
- Parse هر دو فایل `compose.yml` و `portainer-stack.yml` — PASS
- نصب Production dependencyها با `npm ci --omit=dev --ignore-scripts` — PASS
- `git diff --check` — PASS

## پوشش اصلی

- Authentication، Session، آخرین Admin و نقش محدود Branch
- Company/Branch/Site، Personnel و دسترسی Scopeشده
- IPAM از `/16` تا IP، Migrationها و Import/Export
- Inventory، فیلتر شرکت، Device Type و CSV
- جداسازی Capability ماژول از Role و کشف `module.json`
- Radio AP/Station، Station بدون AP، جستجوی والد/فرزند و عملیات مستقل Edit/IPAM/Ping
- عدم ذخیره رمز تجهیزات و حذف Helper قدیمی Secret
- Backup دستی/زمان‌بندی‌شده، Update ایمن و Rollback فایل برنامه
- منوی پنج‌گزینه‌ای Installer، نصب مستقیم از ZIP و تنظیم Cookie Secure
- فقط دو زبان فارسی و انگلیسی و ثابت‌ماندن Sidebar در سمت چپ
- ثبت پرسنل فقط با نام و nullable بودن کد پرسنلی در Schema واقعی
- افزودن و ویرایش Host/Equipment در Schema واقعی
- حفظ AP والد در افزودن Station و حفظ آخرین رنج IPAM
- ارتفاع واکنش‌گرای نقشه در Viewportهای 1080 و 1440
- کلاینت Windows v0.7.1 و ارسال فقط `IP:PORT` به WinBox

## تست Docker

در محیط Build فعلی Docker CLI و Docker daemon وجود ندارد؛ بنابراین اجرای واقعی Containerها در همین محیط ممکن نبود و نباید به‌عنوان PASS گزارش شود.

اسکریپت `scripts/docker-release-smoke.sh` برای اجرای ایزوله روی میزبان Docker آماده شده است. این تست Compose config، Build، Fresh start، Health، Login، API نوشتن، Backup واقعی `pg_dump` و ماندگاری داده پس از بازسازی Containerها را بررسی می‌کند و در پایان Volume و Network آزمایشی خودش را حذف می‌کند.

```bash
sudo ./scripts/docker-release-smoke.sh
```

این تنها مورد باقی‌مانده برای تأیید «اجرای واقعی Docker» است.
