# راهنمای نصب EMS_IPAM

## روش پیشنهادی: نصب کامل با یک دستور

این دستور پروژه را مستقیماً از GitHub رسمی دریافت می‌کند. اگر Docker، Docker Compose یا Portainer وجود نداشته باشد، Installer آن‌ها را نصب می‌کند.

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash
```

منو:

```text
1) Install
2) Update
3) Uninstall application (keep database)
4) Uninstall application + database
```

### گزینه ۱ — Install

در نصب تازه موارد زیر انجام می‌شود:

1. بررسی سیستم و پیش‌نیازها
2. نصب Docker Engine در صورت نبودن
3. نصب Docker Compose Plugin در صورت نبودن
4. نصب Portainer CE در صورت نبودن
5. دانلود آخرین سورس از `emsebi/EMS_IPAM`
6. دریافت Username و Password ادمین
7. تولید خودکار رمز PostgreSQL و Session Secret
8. ساخت PostgreSQL Volume پایدار
9. Build و Start سرویس‌ها
10. Health Check واقعی پنل
11. نمایش URL پنل

اگر قبلاً گزینه ۳ اجرا شده باشد، Install مجدد State و دیتابیس قبلی را تشخیص داده و بدون حذف اطلاعات پنل را دوباره نصب می‌کند.

### گزینه ۲ — Update

قبل از Update:

- Backup پایگاه داده ساخته می‌شود.
- `.env` و State پایدار دست‌نخورده می‌ماند.
- نسخه جدید GitHub در مسیر موقت آماده می‌شود.
- فقط پس از آماده شدن فایل‌ها، نسخه قبلی جابه‌جا می‌شود.
- Health Check انجام می‌شود.
- در صورت Fail شدن Update، فایل‌های نسخه قبلی Rollback می‌شوند.

برای اجرای مستقیم Update بدون منو:

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash -s -- update
```

### گزینه ۳ — حذف برنامه بدون دیتابیس

این گزینه Containerهای EMS_IPAM و فایل‌های `/opt/ems-ipam` را حذف می‌کند اما موارد زیر باقی می‌مانند:

```text
/var/lib/ems-ipam
ems_ipam_db_data
```

نصب دوباره با گزینه ۱ همان دیتابیس را استفاده می‌کند.

### گزینه ۴ — حذف کامل

پس از تأیید کاربر موارد زیر حذف می‌شوند:

- فایل‌های برنامه
- Database Volume
- تنظیمات Installer
- Backupهای موجود در State

Docker و Portainer حذف نمی‌شوند.

## نصب فقط پیش‌نیازها

برای زمانی که مدیر فقط می‌خواهد Docker و Portainer آماده شوند:

```bash
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash -s -- prereqs
```

## مسیرها

```text
Application: /opt/ems-ipam
State:       /var/lib/ems-ipam
Env:         /var/lib/ems-ipam/.env
Backups:     /var/lib/ems-ipam/backups
DB Volume:   ems_ipam_db_data
Network:     ems_ipam_internal
```

## GitHub Workflow

فایل ZIP هر مرحله طوری ساخته می‌شود که محتویات آن مستقیماً در ریشه Repository قرار بگیرند. ZIP را Extract کنید و فایل‌ها/پوشه‌های آن را در ریشه `EMS_IPAM` جایگزین یا اضافه کنید، سپس Commit کنید.

برای مراحل بعد، بیشتر تغییرات فقط داخل پوشه ماژول مربوطه خواهند بود؛ مثلاً مرحله IPAM فقط پوشه `modules/ipam/` و در صورت نیاز فایل‌های مستندات مرتبط را اضافه می‌کند.
