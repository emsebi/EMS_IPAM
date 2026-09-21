# Release v1.5.1-base-fix

این نسخه بازبینی Base و IPAM و اضافه شدن اولین افزونه مستقل Radio است.

## اصلاحات Base

- زبان پیش‌فرض English و کلید FA/EN.
- Sidebar در هر دو زبان سمت چپ ثابت است.
- Theme toggle و Settings همچنان مستقل از زبان هستند.
- Contactهای شرکت/شعبه با Phone، Mobile و Email جداگانه نمایش داده می‌شوند.
- Users و Personnel در Settings مسیر Back واضح دارند.
- Personnel دارای Create/Edit/Delete، Import CSV، Export CSV و جستجو است.
- Device Type از لیست ثابت خارج شده و Admin می‌تواند Type را Create/Edit/Delete کند.
- Inventory بر اساس Device Type فیلتر و شمارش می‌شود و Export کل یا فیلترشده دارد.
- Serviceهای هر IP قابل انتخاب هستند و Port اختصاصی هر Service ذخیره می‌شود.

## Radio

- `modules/radio` اولین افزونه همراه Base است.
- AP/Station با IPAM و Inventory مشترک هستند.
- جستجو با Name/IP/MAC/SSID.
- Add Station از AP و Edit/Delete/Open IP/View in IPAM.
- بدون مانیتورینگ Signal/Performance و بدون ذخیره Credential.

## Update Safety

- PostgreSQL volume در Update حذف نمی‌شود.
- `/var/lib/ems-ipam/.env` در Update حفظ می‌شود.
- قبل از Update، `pg_dump` اجباری و غیرخالی بودن Backup بررسی می‌شود.
- در Fail شدن Health Check فایل‌های Application به نسخه قبلی Rollback می‌شوند.
