# ایمنی نصب و Update

اطلاعات عملیاتی EMS IPAM در Docker volume پایدار `ems_ipam_db_data` نگهداری می‌شوند. فایل تنظیمات پایدار نیز در `/var/lib/ems-ipam/.env` است.

## Update

Update باید این ترتیب را رعایت کند:

1. بررسی نصب معتبر و Docker.
2. ساخت Backup اجباری PostgreSQL.
3. بررسی غیرخالی بودن Backup.
4. دانلود نسخه جدید در مسیر موقت.
5. جابه‌جایی فایل‌های Application به صورت Staged.
6. Build و Health Check.
7. در صورت Fail شدن، Rollback فایل‌های Application.

Update حق ندارد `docker compose down -v`، حذف volume دیتابیس، Reset دیتابیس یا پاک‌کردن State را انجام دهد.

تنها گزینه `Uninstall application + database` اجازه حذف دیتابیس را دارد و قبل از آن تأیید صریح می‌گیرد.

## توصیه نسخه نهایی

قبل از Update در محیط عملیاتی، وجود Backup سالم را علاوه بر ساخته‌شدن فایل با Restore Test دوره‌ای بررسی کنید.
